import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { Attribute, isAttribute } from "../ast/attribute.ts";
import { isComment } from "../ast/comment.ts";
import { Element as ElementNode, isElement, type Child } from "../ast/element.ts";
import { Name as AstName } from "../ast/name.ts";
import { isProcessingInstruction } from "../ast/processing-instruction.ts";
import { isCData, isText } from "../ast/text.ts";
import {
  CurrentDecodeState,
  CurrentEncodeState,
  isXmlSpaceAttribute,
  PlacementBindings,
  registerProjectionAlias,
  resolvePlacementName,
} from "./context.ts";
import {
  astNameFields,
  codecNameLabel,
  hasExpandedName,
  resolvedCodecName,
  type ResolvedCodecName,
} from "./codec-name.ts";
import { failIssues } from "./issue.ts";
import { encoded, getPlacement, type Encodes } from "./metadata.ts";
import { associateSource } from "./provenance.ts";

const xsiNamespace = "http://www.w3.org/2001/XMLSchema-instance";

const isNilAttribute = (attribute: Attribute) =>
  attribute.name.localName === "nil" && attribute.name.namespaceUri === xsiNamespace;

const issueAt = <Input>(
  message: string,
  input: Input,
  options: SchemaAST.ParseOptions,
  node: Attribute | Child | ElementNode,
) =>
  Effect.map(CurrentDecodeState, (state) => {
    const issue = new SchemaIssue.InvalidValue({ message }, input, options);
    const location = state?.positions.get(node);
    return location === undefined
      ? issue
      : associateSource(issue, {
          location: () => location,
        });
  });

const checkElementName = (
  element: ElementNode,
  name: ResolvedCodecName | undefined,
  options: SchemaAST.ParseOptions,
) => {
  if (name === undefined) {
    return Effect.flatMap(
      issueAt(
        "A name-less nil XML element must be used as an Xml.Struct field",
        element,
        options,
        element,
      ),
      Effect.fail,
    );
  }
  if (hasExpandedName(element.name, name)) return Effect.succeed(name);
  return Effect.flatMap(
    issueAt(
      `Expected XML element ${JSON.stringify(codecNameLabel(name))}`,
      element,
      options,
      element,
    ),
    Effect.fail,
  );
};

const lexicalNil = (attribute: Attribute, options: SchemaAST.ParseOptions) => {
  if (attribute.value === "true" || attribute.value === "1") return Effect.succeed(true);
  if (attribute.value === "false" || attribute.value === "0") return Effect.succeed(false);
  return Effect.flatMap(
    issueAt("xsi:nil must be one of true, 1, false, or 0", attribute, options, attribute),
    Effect.fail,
  );
};

const withoutNilAttribute = (element: ElementNode) =>
  Effect.map(CurrentDecodeState, (state) => {
    const fields = {
      name: element.name,
      namespaceDeclarations: element.namespaceDeclarations,
      attributes: element.attributes.filter((attribute) => !isNilAttribute(attribute)),
      children: element.children,
    };
    const projected =
      element.span === undefined
        ? new ElementNode(fields)
        : new ElementNode({ ...fields, span: element.span });
    registerProjectionAlias(state, element, projected);
    return projected;
  });

const nilledContentIssues = (
  element: ElementNode,
  options: SchemaAST.ParseOptions,
  ast: SchemaAST.AST,
) =>
  Effect.flatMap(CurrentDecodeState, (state) => {
    const nodes: Array<Attribute | Child> = [];
    if (options.onExcessProperty === "error") {
      for (const attribute of element.attributes) {
        if (!isNilAttribute(attribute) && !isXmlSpaceAttribute(attribute)) nodes.push(attribute);
      }
    }
    for (const child of element.children) {
      if (isText(child) || isCData(child) || isElement(child)) nodes.push(child);
      else if (!isComment(child) && !isProcessingInstruction(child)) nodes.push(child);
    }
    if (nodes.length === 0) return Effect.void;

    const issues = nodes.map((node) => {
      const issue = new SchemaIssue.InvalidValue(
        {
          message: isAttribute(node)
            ? "Unexpected XML attribute on an xsi:nil element"
            : "An xsi:nil element must not contain text, CDATA, or child elements",
        },
        node,
        options,
      );
      const location = state?.positions.get(node);
      return location === undefined
        ? issue
        : associateSource(issue, {
            location: () => location,
          });
    });
    return failIssues(ast, issues, element, options);
  });

/** Adds explicit xsi:nil null semantics to an XML element codec. */
// RETURN TYPE: Preserves the wrapped element's decode and encode service requirements.
export const Nil = <S extends Encodes<ElementNode>>(
  element: S,
): Schema.Codec<S["Type"] | null, ElementNode, S["DecodingServices"], S["EncodingServices"]> => {
  const placement = getPlacement(element);
  if (placement?.kind !== "element") {
    throw new Error("Xml.Nil requires an XML element codec with retained placement");
  }

  const raw = encoded(isElement, placement);
  const nullable = Schema.NullOr(element);
  return raw.pipe(
    Schema.decodeTo(
      nullable,
      SchemaTransformation.transformEffect({
        decode: (input, options) =>
          Effect.flatMap(PlacementBindings, (scope) => {
            const expectedName =
              resolvedCodecName(placement.name) ?? resolvePlacementName(scope, placement.token);
            return Effect.flatMap(checkElementName(input, expectedName, options), () => {
              const controls = input.attributes.filter(isNilAttribute);
              if (controls.length > 1) {
                return Effect.flatMap(
                  issueAt(
                    "An XML element must not contain duplicate xsi:nil attributes",
                    controls,
                    options,
                    input,
                  ),
                  Effect.fail,
                );
              }
              const control = controls[0];
              if (control === undefined) return Effect.succeed(input);
              return Effect.flatMap(lexicalNil(control, options), (nilled) => {
                if (!nilled) return withoutNilAttribute(input);
                return Effect.as(nilledContentIssues(input, options, raw.ast), null);
              });
            });
          }),
        encode: (input, options) => {
          if (input !== null) return Effect.succeed(input);
          return Effect.flatMap(PlacementBindings, (scope) => {
            const name =
              resolvedCodecName(placement.name) ?? resolvePlacementName(scope, placement.token);
            if (name === undefined) {
              return Effect.fail(
                new SchemaIssue.InvalidValue(
                  { message: "A name-less nil XML element must be used as an Xml.Struct field" },
                  input,
                  options,
                ),
              );
            }
            return Effect.map(CurrentEncodeState, (state) => {
              const output = new ElementNode({
                name: new AstName(astNameFields(name)),
                namespaceDeclarations: [],
                attributes: [
                  new Attribute({
                    name: new AstName({
                      localName: "nil",
                      namespaceUri: xsiNamespace,
                      prefix: "xsi",
                    }),
                    value: "true",
                  }),
                ],
                children: [],
              });
              state?.typed.add(output);
              if (placement.structured) state?.structured.add(output);
              return output;
            });
          });
        },
      }),
    ),
  );
};
