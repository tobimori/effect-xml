import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { Attribute, isAttribute } from "../ast/attribute.ts";
import { Element, isElement, type Child } from "../ast/element.ts";
import { isText } from "../ast/text.ts";
import { isXmlWhitespace } from "../parser/character.ts";
import {
  CurrentDecodeState,
  CurrentEncodeState,
  CurrentStructDecodeIssues,
  isXmlSpaceAttribute,
  PlacementBindings,
  registerXmlSpace,
  type ProjectedNode,
  type StructDecodeIssuesState,
} from "./context.ts";
import {
  codecNameLabel,
  hasExpandedName,
  withLocalName,
  type ResolvedCodecName,
} from "./codec-name.ts";
import { failIssues } from "./issue.ts";
import {
  encoded,
  getPlacement,
  isElementContent,
  type ElementContent,
  type Placement,
  type StructField,
} from "./metadata.ts";

interface FieldSpec {
  readonly key: PropertyKey;
  readonly placement: Exclude<Placement, { readonly kind: "struct" | "document" }>;
  readonly name: ResolvedCodecName;
  readonly optional: boolean;
}

const encodedOptional = (field: StructField) =>
  SchemaAST.isOptional(SchemaAST.toEncoded(field.ast));

const duplicateIssue = (
  key: PropertyKey,
  kind: "attribute" | "element",
  name: ResolvedCodecName,
  input: ReadonlyArray<Attribute | Child | undefined>,
  options: SchemaAST.ParseOptions,
) =>
  new SchemaIssue.Pointer(
    [key],
    new SchemaIssue.InvalidValue(
      {
        message: `Duplicate known XML ${kind} ${JSON.stringify(codecNameLabel(name))}`,
      },
      input,
      options,
    ),
  );

const optionalBareArrayIssue = <Input>(
  key: PropertyKey,
  input: Input,
  options: SchemaAST.ParseOptions,
) =>
  new SchemaIssue.Pointer(
    [key],
    new SchemaIssue.InvalidValue(
      {
        message:
          "An optional bare Xml.Array placement is ambiguous; use a required Xml.Array for zero-or-more, or an optional Xml.Element(Xml.Array(...)) wrapper when absence and an empty array must remain distinct",
      },
      input,
      options,
    ),
  );

/** Maps unordered attributes and known child elements through a standard Effect Struct. */
// RETURN TYPE: Exposes the standard Struct type and service inference over ElementContent.
export const Struct = <const Fields extends Readonly<Record<PropertyKey, StructField>>>(
  fields: Fields,
): Schema.Codec<
  Schema.Struct.Type<Fields>,
  ElementContent,
  Schema.Struct.DecodingServices<Fields>,
  Schema.Struct.EncodingServices<Fields>
> => {
  const specs: Array<FieldSpec> = [];
  const boundFields: Record<PropertyKey, StructField> = Object.create(null);
  const ownership = new Map<string, PropertyKey>();

  for (const key of Reflect.ownKeys(fields)) {
    const field = fields[key]!;
    const placement = getPlacement(field);
    if (placement === undefined || placement.kind === "struct" || placement.kind === "document") {
      throw new Error(`Xml.Struct field ${String(key)} has no compatible XML placement`);
    }
    const direct = placement.kind === "array" ? placement.item : placement;
    const localName = direct.name.localName ?? (Predicate.isString(key) ? key : undefined);
    if (localName === undefined) {
      throw new Error(`Xml.Struct cannot infer an XML name from symbol field ${String(key)}`);
    }
    const name = withLocalName(direct.name, localName);

    const domain = placement.kind === "attribute" ? "attribute" : "element";
    const ownershipKey = JSON.stringify([domain, name.namespaceUri ?? null, name.localName]);
    const owner = ownership.get(ownershipKey);
    if (owner !== undefined) {
      throw new Error(
        `Xml.Struct fields ${String(owner)} and ${String(key)} both own XML ${domain} ${JSON.stringify(codecNameLabel(name))}`,
      );
    }
    ownership.set(ownershipKey, key);

    const provideName = <Value, Error, Services>(effect: Effect.Effect<Value, Error, Services>) =>
      Effect.flatMap(PlacementBindings, (parent) =>
        Effect.provideService(effect, PlacementBindings, {
          parent,
          token: direct.token,
          name,
        }),
      );

    const boundField =
      direct.name.localName === undefined
        ? Schema.middlewareEncoding(provideName)(Schema.middlewareDecoding(provideName)(field))
        : field;
    // SAFETY: Decoding and encoding middleware preserve the field's encoded XML category.
    boundFields[key] = boundField as StructField;
    specs.push({ key, placement, name, optional: encodedOptional(field) });
  }

  const optionalBareArraySpecs = specs.filter(
    (spec) => spec.optional && spec.placement.kind === "array",
  );
  const fieldSchema = Schema.Struct(boundFields);
  const raw = encoded(isElementContent, { kind: "struct" });
  const codec = raw.pipe(
    Schema.decodeTo(
      fieldSchema,
      SchemaTransformation.transformEffect({
        decode: (content, options) => {
          if (optionalBareArraySpecs.length > 0) {
            return failIssues(
              fieldSchema.ast,
              optionalBareArraySpecs.map((spec) =>
                optionalBareArrayIssue(spec.key, content, options),
              ),
              content,
              options,
            );
          }
          return Effect.flatMap(CurrentDecodeState, (state) =>
            Effect.flatMap(CurrentStructDecodeIssues, (scope) => {
              const output: Record<
                PropertyKey,
                Attribute | Child | ReadonlyArray<Element> | undefined
              > = Object.create(null);
              const projected = new Map<PropertyKey, ProjectedNode>();
              const attributes = new Set<number>();
              const children = new Set<number>();
              const preservesSpace =
                content.element === undefined ? false : registerXmlSpace(state, content.element);

              for (let index = 0; index < content.attributes.length; index++) {
                const attribute = content.attributes[index];
                if (attribute !== undefined && isXmlSpaceAttribute(attribute))
                  attributes.add(index);
              }

              for (const spec of specs) {
                if (spec.placement.kind === "attribute") {
                  const matches: Array<number> = [];
                  for (let index = 0; index < content.attributes.length; index++) {
                    const attribute = content.attributes[index];
                    if (attribute !== undefined && hasExpandedName(attribute.name, spec.name)) {
                      matches.push(index);
                    }
                  }
                  const first = matches[0];
                  if (first !== undefined) {
                    const attribute = content.attributes[first]!;
                    output[spec.key] = attribute;
                    projected.set(spec.key, attribute);
                    for (const index of matches) attributes.add(index);
                  }
                  if (matches.length > 1) {
                    const issue = duplicateIssue(
                      spec.key,
                      "attribute",
                      spec.name,
                      matches.map((index) => content.attributes[index]),
                      options,
                    );
                    scope?.issues.push(issue);
                    if (scope !== undefined) scope.input = content;
                  }
                  continue;
                }

                const matches: Array<number> = [];
                for (let index = 0; index < content.children.length; index++) {
                  const child = content.children[index];
                  if (
                    child !== undefined &&
                    isElement(child) &&
                    hasExpandedName(child.name, spec.name)
                  ) {
                    matches.push(index);
                  }
                }

                if (spec.placement.kind === "array") {
                  const elements: Array<Element> = [];
                  for (const index of matches) {
                    const child = content.children[index];
                    if (child !== undefined && isElement(child)) {
                      elements.push(child);
                      registerXmlSpace(state, child, preservesSpace);
                    }
                  }
                  output[spec.key] = elements;
                  projected.set(spec.key, elements);
                  for (const index of matches) children.add(index);
                } else {
                  const first = matches[0];
                  if (first !== undefined) {
                    const element = content.children[first];
                    if (element !== undefined && isElement(element)) {
                      output[spec.key] = element;
                      projected.set(spec.key, element);
                      registerXmlSpace(state, element, preservesSpace);
                      for (const index of matches) children.add(index);
                    }
                  }
                  if (matches.length > 1) {
                    const issue = duplicateIssue(
                      spec.key,
                      "element",
                      spec.name,
                      matches.map((index) => content.children[index]),
                      options,
                    );
                    scope?.issues.push(issue);
                    if (scope !== undefined) scope.input = content;
                  }
                }
              }

              for (let index = 0; index < content.attributes.length; index++) {
                if (!attributes.has(index)) {
                  const attribute = content.attributes[index]!;
                  output[Symbol(`XML attribute ${attribute.name.qualifiedName}`)] = attribute;
                }
              }
              for (let index = 0; index < content.children.length; index++) {
                if (children.has(index)) continue;
                const child = content.children[index]!;
                if (isText(child) && !preservesSpace && isXmlWhitespace(child.value)) continue;
                let description = "XML content";
                if (isElement(child)) description = child.name.qualifiedName;
                else if (isText(child)) description = "Text";
                output[Symbol(`XML child ${description} ${index}`)] = child;
              }

              if (state !== undefined && content.element !== undefined) {
                state.projections.set(content.element, projected);
              }
              // SAFETY: Declared keys have their retained placement category; extra child values
              // are intentional unknown properties consumed by ordinary Struct excess handling.
              return Effect.succeed(output as Schema.Struct.Encoded<typeof boundFields>);
            }),
          );
        },
        encode: (values, options) => {
          if (optionalBareArraySpecs.length > 0) {
            return failIssues(
              fieldSchema.ast,
              optionalBareArraySpecs.map((spec) =>
                optionalBareArrayIssue(spec.key, values, options),
              ),
              values,
              options,
            );
          }
          return Effect.flatMap(CurrentEncodeState, (state) => {
            const attributes: Array<{ readonly key: PropertyKey; readonly value: Attribute }> = [];
            const children: Array<Element> = [];
            const issues: Array<SchemaIssue.Issue> = [];
            // SAFETY: This mapped view is the field-addressable form of Struct.Encoded<Fields>.
            const encodedValues = values as {
              readonly [Key in keyof Fields]?: Fields[Key]["Encoded"];
            };

            for (const spec of specs) {
              // SAFETY: Specs are created only from Reflect.ownKeys(fields) above.
              const value = encodedValues[spec.key as keyof Fields];
              if (value === undefined) {
                if (!spec.optional) {
                  issues.push(
                    new SchemaIssue.Pointer(
                      [spec.key],
                      new SchemaIssue.InvalidValue(
                        { message: "A required XML placement encoded to undefined" },
                        value,
                        options,
                      ),
                    ),
                  );
                }
                continue;
              }
              if (spec.placement.kind === "attribute") {
                if (isAttribute(value)) attributes.push({ key: spec.key, value });
                else {
                  issues.push(
                    new SchemaIssue.Pointer(
                      [spec.key],
                      new SchemaIssue.InvalidValue(
                        { message: "Expected an encoded XML attribute" },
                        value,
                        options,
                      ),
                    ),
                  );
                }
              } else if (spec.placement.kind === "element") {
                if (isElement(value)) children.push(value);
                else {
                  issues.push(
                    new SchemaIssue.Pointer(
                      [spec.key],
                      new SchemaIssue.InvalidValue(
                        { message: "Expected an encoded XML element" },
                        value,
                        options,
                      ),
                    ),
                  );
                }
              } else if (globalThis.Array.isArray(value) && value.every(isElement)) {
                for (const element of value) children.push(element);
              } else {
                issues.push(
                  new SchemaIssue.Pointer(
                    [spec.key],
                    new SchemaIssue.InvalidValue(
                      { message: "Expected encoded XML elements" },
                      value,
                      options,
                    ),
                  ),
                );
              }
            }

            if (issues.length > 0) return failIssues(fieldSchema.ast, issues, values, options);
            if (state?.sortKeys !== false) {
              attributes.sort((left, right) => {
                const leftKey = String(left.key);
                const rightKey = String(right.key);
                if (leftKey < rightKey) return -1;
                if (leftKey > rightKey) return 1;
                return 0;
              });
            }
            return Effect.succeed({
              attributes: attributes.map(({ value }) => value),
              children,
            });
          });
        },
      }),
    ),
  );

  const withStructuralIssues = <A, R>(
    effect: Effect.Effect<A, SchemaIssue.Issue, R>,
    options: SchemaAST.ParseOptions,
  ) => {
    const scope: StructDecodeIssuesState = { issues: [] };
    const scoped = Effect.provideService(effect, CurrentStructDecodeIssues, scope);
    return Effect.matchEffect(scoped, {
      onFailure: (fieldIssue) => {
        if (scope.issues.length === 0) return Effect.fail(fieldIssue);
        if (options.errors !== "all") return Effect.fail(scope.issues[0]!);
        const combined: [SchemaIssue.Issue, ...Array<SchemaIssue.Issue>] = [
          scope.issues[0]!,
          ...scope.issues.slice(1),
          fieldIssue,
        ];
        return Effect.fail(
          new SchemaIssue.Composite(fieldSchema.ast, combined, scope.input, options),
        );
      },
      onSuccess: (value) =>
        scope.issues.length === 0
          ? Effect.succeed(value)
          : failIssues(fieldSchema.ast, scope.issues, scope.input, options),
    });
  };

  // SAFETY: The bound field view changes only lexical context, not the public Struct shape.
  return codec.pipe(Schema.middlewareDecoding(withStructuralIssues)) as Schema.Codec<
    Schema.Struct.Type<Fields>,
    ElementContent,
    Schema.Struct.DecodingServices<Fields>,
    Schema.Struct.EncodingServices<Fields>
  >;
};
