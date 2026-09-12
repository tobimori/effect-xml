import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import type { Attribute } from "../ast/attribute.ts";
import { isComment } from "../ast/comment.ts";
import { Element as ElementNode, isChild, isElement, type Child } from "../ast/element.ts";
import { Name as AstName } from "../ast/name.ts";
import { Text, isCData, isText } from "../ast/text.ts";
import { isName, type Name } from "../namespace/name.ts";
import {
  attachEncodedRest,
  CurrentDecodeState,
  CurrentEncodeState,
  CurrentXmlElementDecodeContext,
  enterXmlElementDecodeContext,
  isXmlSpaceAttribute,
  PlacementBindings,
  resolvePlacementName,
  type DecodeState,
} from "./context.ts";
import {
  codecNameFrom,
  codecNameLabel,
  hasExpandedName,
  resolvedCodecName,
  type CodecName,
  type ResolvedCodecName,
} from "./codec-name.ts";
import { delegateRequired } from "./delegate.ts";
import { failIssues } from "./issue.ts";
import {
  acceptsEncodedUndefined,
  encoded,
  getPlacement,
  isElementContent,
  isSingleChildPlacement,
  resolveChildPlacements,
  resolveSuspendedPlacement,
  type ElementContent,
  type PlacementToken,
} from "./metadata.ts";
import { canonicalizeOrderedChildren, validateOrderedChildren } from "./ordered-content.ts";
import { guardParsePath } from "./path-guard.ts";
import { associateSource } from "./provenance.ts";
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
  state?: DecodeState,
) => {
  const issue = new SchemaIssue.InvalidValue(
    { message: `Unexpected ${description} in XML element content` },
    input,
    options,
  );
  const location = state?.positions.get(input);
  return location === undefined ? issue : associateSource(issue, { location: () => location });
};

const describeChild = (child: Child) => {
  if (isText(child)) return "text";
  if (isCData(child)) return "CDATA";
  if (isElement(child)) return `XML element ${JSON.stringify(child.name.qualifiedName)}`;
  return isComment(child) ? "XML comment" : "XML processing instruction";
};

interface ElementDecodeIssues {
  readonly issues: Array<SchemaIssue.Issue>;
  input?: unknown;
}

const CurrentElementDecodeIssues = Context.Reference<ElementDecodeIssues | undefined>(
  "effect-xml/schema/CurrentElementDecodeIssues",
  { defaultValue: () => undefined },
);

const deferElementIssues = <Input>(
  ast: SchemaAST.AST,
  issues: ReadonlyArray<SchemaIssue.Issue>,
  input: Input,
  options: SchemaAST.ParseOptions,
) => {
  if (issues.length === 0) return Effect.void;
  return Effect.flatMap(CurrentElementDecodeIssues, (scope) => {
    if (options.errors !== "all" || scope === undefined) {
      return failIssues(ast, issues, input, options);
    }
    scope.issues.push(...issues);
    scope.input = input;
    return Effect.void;
  });
};

const checkOrderedAttributes = (
  element: ElementNode,
  options: SchemaAST.ParseOptions,
  ast: SchemaAST.AST,
  state?: DecodeState,
) => {
  if (options.onExcessProperty !== "error") return Effect.void;
  const issues: Array<SchemaIssue.Issue> = [];
  for (const attribute of element.attributes) {
    if (!isXmlSpaceAttribute(attribute)) {
      issues.push(
        unexpectedContentIssue(
          `XML attribute ${JSON.stringify(attribute.name.qualifiedName)}`,
          attribute,
          options,
          state,
        ),
      );
    }
  }
  return deferElementIssues(ast, issues, element, options);
};

const decodeSimpleTextValue = (
  element: ElementNode,
  options: SchemaAST.ParseOptions,
  ast: SchemaAST.AST,
) => {
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
};

const registerOrderedChildren = (
  state: DecodeState | undefined,
  element: ElementNode,
  children: ReadonlyArray<Child>,
) => {
  if (state === undefined) return;
  const projected = new Map<PropertyKey, Child>();
  for (let index = 0; index < children.length; index++) {
    projected.set(index, children[index]!);
  }
  state.projections.set(element, projected);
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
            Effect.flatMapEager(checkName(element, name, options), () =>
              Effect.flatMap(CurrentXmlElementDecodeContext, (context) =>
                decodeContent(element, options, raw.ast, context?.preservesSpace ?? false),
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
                      name: new AstName(name),
                      namespaceDeclarations: [],
                      attributes,
                      children,
                    });
                    state?.typed.add(element);
                    if (structured) state?.structured.add(element);
                    if (isElementContent(value)) attachEncodedRest(state, value, element);
                    return element;
                  }),
                ),
          ),
      }),
    ),
  );

  return delegateRequired(
    codec,
    (effect, options, input) => {
      const scope: ElementDecodeIssues = { issues: [] };
      const scoped = Effect.provideService(effect, CurrentElementDecodeIssues, scope);
      const accumulated = Effect.matchEffect(scoped, {
        onFailure: (contentIssue) => {
          if (scope.issues.length === 0) return Effect.fail(contentIssue);
          const issues: [SchemaIssue.Issue, ...Array<SchemaIssue.Issue>] = [
            scope.issues[0]!,
            ...scope.issues.slice(1),
            contentIssue,
          ];
          return Effect.fail(new SchemaIssue.Composite(raw.ast, issues, scope.input, options));
        },
        onSuccess: (value) =>
          scope.issues.length === 0
            ? Effect.succeed(value)
            : failIssues(raw.ast, scope.issues, scope.input, options),
      });
      return guardParsePath(
        input,
        Effect.flatMap(CurrentDecodeState, (state) => {
          const activeState: DecodeState = state ?? {
            positions: new WeakMap(),
            projections: new WeakMap(),
            namespaceSnapshots: new WeakMap(),
          };
          const contextual = Effect.flatMap(CurrentXmlElementDecodeContext, (parent) =>
            isElement(input)
              ? Effect.provideService(
                  accumulated,
                  CurrentXmlElementDecodeContext,
                  enterXmlElementDecodeContext(activeState, input, parent),
                )
              : accumulated,
          );
          return state === undefined
            ? Effect.provideService(contextual, CurrentDecodeState, activeState)
            : contextual;
        }),
        options,
      );
    },
    (effect) => effect,
  );
};

export type ElementContentInput<S extends Schema.Constraint> =
  Extract<S["Encoded"], Attribute> extends never ? S : never;

/** Wraps scalar or structured content in a named XML element. */
export function Element<S extends Schema.Constraint>(
  content: ElementContentInput<S>,
): Schema.Codec<S["Type"], ElementNode, S["DecodingServices"], S["EncodingServices"]>;
export function Element<S extends Schema.Constraint>(
  name: string | Name,
  content: ElementContentInput<S>,
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
      placement.structured,
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

  if (placement?.kind === "array" || placement?.kind === "tuple") {
    return makeElementCodec(
      explicitName,
      content,
      false,
      (element, options, ast) =>
        Effect.flatMap(CurrentDecodeState, (state) => {
          const children = canonicalizeOrderedChildren(element.children, state);
          if (placement.kind === "array" && options.onExcessProperty === "error") {
            const resolved = resolveChildPlacements(placement.item, true);
            if (
              resolved.complete &&
              resolved.placements.every((childPlacement) => childPlacement.kind === "element")
            ) {
              const issues = children
                .filter((child) => !isElement(child))
                .map((child) =>
                  unexpectedContentIssue(describeChild(child), child, options, state),
                );
              return Effect.flatMapEager(
                Effect.flatMapEager(checkOrderedAttributes(element, options, ast, state), () =>
                  deferElementIssues(ast, issues, element, options),
                ),
                () => {
                  registerOrderedChildren(state, element, children);
                  return Effect.succeed(children as S["Encoded"]);
                },
              );
            }
          }
          return Effect.flatMapEager(checkOrderedAttributes(element, options, ast, state), () => {
            registerOrderedChildren(state, element, children);
            return Effect.succeed(children as S["Encoded"]);
          });
        }),
      (value, options) => {
        if (!globalThis.Array.isArray(value) || !value.every(isChild)) {
          return Effect.fail(
            new SchemaIssue.InvalidValue(
              { message: "Expected an encoded ordered XML child sequence" },
              value,
              options,
            ),
          );
        }
        return Effect.mapEager(
          validateOrderedChildren(value, content.ast, options),
          (children) => ({
            attributes: [],
            children,
          }),
        );
      },
    );
  }

  if (placement?.kind === "text") {
    return makeElementCodec(
      explicitName,
      content,
      false,
      (element, options, ast) =>
        Effect.mapEager(
          decodeSimpleTextValue(element, options, ast),
          (value) => new Text({ value }),
        ) as Effect.Effect<S["Encoded"], SchemaIssue.Issue>,
      (value, options) => {
        if (!isText(value)) {
          return Effect.fail(
            new SchemaIssue.InvalidValue(
              { message: "Expected encoded simple XML text content" },
              value,
              options,
            ),
          );
        }
        return Effect.succeed({
          attributes: [],
          children: value.value === "" ? [] : [value],
        });
      },
    );
  }

  if (placement !== undefined && isSingleChildPlacement(placement)) {
    const optional = acceptsEncodedUndefined(content);
    return makeElementCodec(
      explicitName,
      content,
      false,
      (element, options, ast) => {
        if (resolveSuspendedPlacement(placement)?.kind === "text") {
          return Effect.mapEager(
            decodeSimpleTextValue(element, options, ast),
            (value) => new Text({ value }),
          ) as Effect.Effect<S["Encoded"], SchemaIssue.Issue>;
        }
        return Effect.flatMap(CurrentDecodeState, (state) =>
          Effect.flatMapEager(checkOrderedAttributes(element, options, ast, state), () => {
            const children = canonicalizeOrderedChildren(element.children, state);
            registerOrderedChildren(state, element, children);
            if (children.length === 0 && optional) {
              return Effect.succeed(undefined as S["Encoded"]);
            }
            if (children.length !== 1) {
              return Effect.fail(
                new SchemaIssue.InvalidValue(
                  { message: "Expected exactly one ordered XML child" },
                  children,
                  options,
                ),
              );
            }
            return Effect.succeed(children[0]! as S["Encoded"]);
          }),
        );
      },
      (value, options) => {
        if (resolveSuspendedPlacement(placement)?.kind === "text" && isText(value)) {
          return Effect.succeed({
            attributes: [],
            children: value.value === "" ? [] : [value],
          });
        }
        if (value === undefined && optional) {
          return Effect.succeed({ attributes: [], children: [] });
        }
        if (!isChild(value)) {
          return Effect.fail(
            new SchemaIssue.InvalidValue(
              { message: "Expected one encoded ordered XML child" },
              value,
              options,
            ),
          );
        }
        return Effect.mapEager(
          validateOrderedChildren([value], content.ast, options),
          (children) => ({
            attributes: [],
            children,
          }),
        );
      },
    );
  }

  if (placement !== undefined) {
    throw new Error(`Xml.Element cannot use XML ${placement.kind} placement as content`);
  }

  const text = scalar(content);
  return makeElementCodec(explicitName, text, false, decodeSimpleTextValue, (value, options) =>
    Effect.map(validateXmlCharacters(value, "XML character data", options), (valid) => ({
      attributes: [],
      children: valid === "" ? [] : [new Text({ value: valid })],
    })),
  );
};
