import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import type { Attribute } from "../ast/attribute.ts";
import { isComment } from "../ast/comment.ts";
import { Element as ElementNode, isElement, type Child } from "../ast/element.ts";
import { Name as AstName } from "../ast/name.ts";
import { Text, isCData, isText } from "../ast/text.ts";
import { isName, type Name } from "../namespace/name.ts";
import { isXmlWhitespace } from "../parser/character.ts";
import {
  CurrentDecodeState,
  CurrentEncodeState,
  isXmlSpaceAttribute,
  PlacementBindings,
  registerXmlSpace,
  resolvePlacementName,
  type DecodeState,
} from "./context.ts";
import {
  astNameFields,
  codecNameFrom,
  codecNameLabel,
  hasExpandedName,
  resolvedCodecName,
  type CodecName,
  type ResolvedCodecName,
} from "./codec-name.ts";
import { failIssues } from "./issue.ts";
import { encoded, getPlacement, type ElementContent, type PlacementToken } from "./metadata.ts";
import { scalar, validateXmlCharacters } from "./scalar.ts";

const resolveName = (explicitName: CodecName, token: PlacementToken) => {
  const ownName = resolvedCodecName(explicitName);
  return Effect.map(PlacementBindings, (scope) => ownName ?? resolvePlacementName(scope, token));
};

const checkName = (
  element: ElementNode,
  name: ResolvedCodecName | undefined,
  options: SchemaAST.ParseOptions,
) => {
  if (name === undefined) {
    return Effect.fail(
      new SchemaIssue.InvalidValue(
        { message: "A name-less XML element must be used as an Xml.Struct field" },
        element,
        options,
      ),
    );
  }
  if (hasExpandedName(element.name, name)) return Effect.succeed(name);
  return Effect.fail(
    new SchemaIssue.InvalidValue(
      { message: `Expected XML element ${JSON.stringify(codecNameLabel(name))}` },
      element,
      options,
    ),
  );
};

const unexpectedContentIssue = (
  description: string,
  input: Attribute | Child,
  options: SchemaAST.ParseOptions,
) =>
  new SchemaIssue.InvalidValue(
    { message: `Unexpected ${description} in XML element content` },
    input,
    options,
  );

const describeChild = (child: Child) => {
  if (isText(child)) return "text";
  if (isCData(child)) return "CDATA";
  if (isElement(child)) return `XML element ${JSON.stringify(child.name.qualifiedName)}`;
  return isComment(child) ? "XML comment" : "XML processing instruction";
};

const makeElementCodec = <S extends Schema.Constraint>(
  explicitName: CodecName,
  target: S,
  structured: boolean,
  decodeContent: (
    element: ElementNode,
    options: SchemaAST.ParseOptions,
    ast: SchemaAST.AST,
    preservesSpace: boolean,
  ) => Effect.Effect<S["Encoded"], SchemaIssue.Issue>,
  encodeContent: (
    encoded: S["Encoded"],
    options: SchemaAST.ParseOptions,
  ) => Effect.Effect<Pick<ElementNode, "attributes" | "children">, SchemaIssue.Issue>,
): Schema.Codec<S["Type"], ElementNode, S["DecodingServices"], S["EncodingServices"]> => {
  const token: PlacementToken = {};
  const raw = encoded(isElement, {
    kind: "element",
    name: explicitName,
    token,
    structured,
  });

  const codec = raw.pipe(
    Schema.decodeTo(
      target,
      SchemaTransformation.transformEffect({
        decode: (element, options) =>
          Effect.flatMap(resolveName(explicitName, token), (name) =>
            Effect.andThen(
              checkName(element, name, options),
              Effect.flatMap(CurrentDecodeState, (state) =>
                decodeContent(element, options, raw.ast, registerXmlSpace(state, element)),
              ),
            ),
          ),
        encode: (value, options) =>
          Effect.flatMap(resolveName(explicitName, token), (name) =>
            name === undefined
              ? Effect.fail(
                  new SchemaIssue.InvalidValue(
                    { message: "A name-less XML element must be used as an Xml.Struct field" },
                    value,
                    options,
                  ),
                )
              : Effect.flatMap(encodeContent(value, options), ({ attributes, children }) =>
                  Effect.map(CurrentEncodeState, (state) => {
                    const element = new ElementNode({
                      name: new AstName(astNameFields(name)),
                      namespaceDeclarations: [],
                      attributes,
                      children,
                    });
                    state?.typed.add(element);
                    if (structured) state?.structured.add(element);
                    return element;
                  }),
                ),
          ),
      }),
    ),
  );

  return codec.pipe(
    Schema.middlewareDecoding((effect) =>
      Effect.flatMap(CurrentDecodeState, (state) => {
        if (state !== undefined) return effect;
        const standaloneState: DecodeState = {
          positions: new WeakMap(),
          projections: new WeakMap(),
          preservesSpace: new WeakMap(),
        };
        return Effect.provideService(effect, CurrentDecodeState, standaloneState);
      }),
    ),
  );
};

/** Wraps scalar or structured content in a named XML element. */
export function Element<S extends Schema.Constraint>(
  content: S,
): Schema.Codec<S["Type"], ElementNode, S["DecodingServices"], S["EncodingServices"]>;
export function Element<S extends Schema.Constraint>(
  name: string | Name,
  content: S,
): Schema.Codec<S["Type"], ElementNode, S["DecodingServices"], S["EncodingServices"]>;
export function Element<S extends Schema.Constraint>(
  nameOrContent: string | Name | S,
  maybeContent?: S,
): Schema.Codec<S["Type"], ElementNode, S["DecodingServices"], S["EncodingServices"]> {
  return makeElement({}, nameOrContent, maybeContent);
}

/** @internal Builds a namespace-factory element without changing the public constructor. */
export const elementWithNameDefaults = <S extends Schema.Constraint>(
  defaults: CodecName,
  nameOrContent: string | S,
  maybeContent?: S,
): Schema.Codec<S["Type"], ElementNode, S["DecodingServices"], S["EncodingServices"]> =>
  makeElement(defaults, nameOrContent, maybeContent);

const makeElement = <S extends Schema.Constraint>(
  defaults: CodecName,
  nameOrContent: string | Name | S,
  maybeContent?: S,
): Schema.Codec<S["Type"], ElementNode, S["DecodingServices"], S["EncodingServices"]> => {
  const named = Predicate.isString(nameOrContent) || isName(nameOrContent);
  const explicitName = codecNameFrom(named ? nameOrContent : undefined, defaults);
  const content = named ? maybeContent! : nameOrContent;
  const placement = getPlacement(content);

  if (placement?.kind === "struct") {
    return makeElementCodec(
      explicitName,
      content,
      true,
      (element) => {
        return Effect.succeed({
          element,
          attributes: element.attributes,
          children: element.children,
        } as S["Encoded"] & ElementContent);
      },
      (value) => {
        const fields = value as S["Encoded"] & ElementContent;
        return Effect.succeed({ attributes: fields.attributes, children: fields.children });
      },
    );
  }

  if (placement?.kind === "array") {
    return makeElementCodec(
      explicitName,
      content,
      false,
      (element, options, ast, preservesSpace) =>
        Effect.flatMap(CurrentDecodeState, (state) => {
          const elements: Array<ElementNode> = [];
          const issues: Array<SchemaIssue.Issue> = [];
          if (options.onExcessProperty === "error") {
            for (const attribute of element.attributes) {
              if (!isXmlSpaceAttribute(attribute)) {
                issues.push(
                  unexpectedContentIssue(
                    `XML attribute ${JSON.stringify(attribute.name.qualifiedName)}`,
                    attribute,
                    options,
                  ),
                );
              }
            }
          }
          for (const child of element.children) {
            if (isElement(child)) {
              elements.push(child);
              registerXmlSpace(state, child, preservesSpace);
            } else if (!(isText(child) && !preservesSpace && isXmlWhitespace(child.value))) {
              if (options.onExcessProperty === "error") {
                issues.push(unexpectedContentIssue(describeChild(child), child, options));
              }
            }
          }
          if (state !== undefined) {
            const projected = new Map<PropertyKey, ElementNode>();
            for (let index = 0; index < elements.length; index++) {
              projected.set(index, elements[index]!);
            }
            state.projections.set(element, projected);
          }
          if (issues.length > 0) return failIssues(ast, issues, element, options);
          return Effect.succeed(elements as S["Encoded"]);
        }),
      (value) => {
        const children = value as ReadonlyArray<ElementNode>;
        return Effect.succeed({ attributes: [], children });
      },
    );
  }

  const text = scalar(content);
  return makeElementCodec(
    explicitName,
    text,
    false,
    (element, options, ast) => {
      let value = "";
      const issues: Array<SchemaIssue.Issue> = [];
      if (options.onExcessProperty === "error") {
        for (const attribute of element.attributes) {
          if (!isXmlSpaceAttribute(attribute)) {
            issues.push(
              unexpectedContentIssue(
                `XML attribute ${JSON.stringify(attribute.name.qualifiedName)}`,
                attribute,
                options,
              ),
            );
          }
        }
      }
      for (const child of element.children) {
        if (isText(child) || isCData(child)) value += child.value;
        else if (isElement(child)) {
          issues.push(
            new SchemaIssue.InvalidValue(
              { message: "Expected simple XML character content" },
              element,
              options,
            ),
          );
        } else if (options.onExcessProperty === "error") {
          issues.push(unexpectedContentIssue(describeChild(child), child, options));
        }
      }
      return issues.length > 0 ? failIssues(ast, issues, element, options) : Effect.succeed(value);
    },
    (value, options) =>
      Effect.map(validateXmlCharacters(value, "XML character data", options), (valid) => ({
        attributes: [],
        children: valid === "" ? [] : [new Text({ value: valid })],
      })),
  );
};
