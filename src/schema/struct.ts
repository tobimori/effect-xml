import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { Attribute, isAttribute } from "../ast/attribute.ts";
import { isComment } from "../ast/comment.ts";
import { isChild, isElement, type Child } from "../ast/element.ts";
import { isProcessingInstruction } from "../ast/processing-instruction.ts";
import { isCData, isText } from "../ast/text.ts";
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
import { delegate, delegateRequired } from "./delegate.ts";
import { failIssues } from "./issue.ts";
import {
  encoded,
  getPlacement,
  isElementContent,
  resolveChildPlacements,
  type ArrayPlacement,
  type AttributePlacement,
  type ConcreteChildPlacement,
  type ElementContent,
  type ElementPlacement,
  type PlacementToken,
  type SingleChildPlacement,
  type StructField,
} from "./metadata.ts";
import { canonicalizeOrderedChildren, validateOrderedChildren } from "./ordered-content.ts";
import { guardProduct } from "./path-guard.ts";

type FieldPlacement = AttributePlacement | SingleChildPlacement | ArrayPlacement;

interface FieldSpec {
  readonly key: PropertyKey;
  readonly placement: FieldPlacement;
  readonly optional: boolean;
}

interface OwnedElementPlacement {
  readonly kind: "element";
  readonly placement: ElementPlacement;
  readonly name: ResolvedCodecName;
}

type OwnedChildPlacement =
  | OwnedElementPlacement
  | Exclude<ConcreteChildPlacement, ElementPlacement>;

const encodedOptional = (field: StructField) =>
  SchemaAST.isOptional(SchemaAST.toEncoded(field.ast));

const resolveAttributeName = (placement: AttributePlacement, key: PropertyKey) => {
  const localName = placement.name.localName ?? (Predicate.isString(key) ? key : undefined);
  return localName === undefined ? undefined : withLocalName(placement.name, localName);
};

const resolveFieldChildren = (spec: FieldSpec, resolveSuspended: boolean) => {
  const placements: Array<OwnedChildPlacement> = [];
  let error: string | undefined;
  if (spec.placement.kind === "attribute") {
    return { placements, complete: true, error };
  }
  const childPlacement = spec.placement.kind === "array" ? spec.placement.item : spec.placement;
  const resolution = resolveChildPlacements(childPlacement, resolveSuspended);

  for (const placement of resolution.placements) {
    if (placement.kind !== "element") {
      placements.push(placement);
      continue;
    }
    const localName =
      placement.name.localName ?? (Predicate.isString(spec.key) ? spec.key : undefined);
    if (localName === undefined) {
      error = `Xml.Struct cannot infer an XML name from symbol field ${String(spec.key)}`;
      return { placements, complete: false, error };
    }
    placements.push({
      kind: "element",
      placement,
      name: withLocalName(placement.name, localName),
    });
  }

  return { placements, complete: resolution.complete, error };
};

const ownershipKey = (placement: OwnedChildPlacement) => {
  if (placement.kind === "element") {
    return JSON.stringify([
      "element",
      placement.name.namespaceUri ?? null,
      placement.name.localName,
    ]);
  }
  return placement.kind === "processing-instruction"
    ? JSON.stringify([placement.kind, placement.target])
    : placement.kind;
};

const ownershipDescription = (placement: OwnedChildPlacement) => {
  if (placement.kind === "element") {
    return `XML element ${JSON.stringify(codecNameLabel(placement.name))}`;
  }
  if (placement.kind === "processing-instruction") {
    return `XML processing instruction ${JSON.stringify(placement.target)}`;
  }
  return `XML ${placement.kind}`;
};

const ownershipConflict = (specs: ReadonlyArray<FieldSpec>, resolveSuspended: boolean) => {
  const ownership = new Map<string, { readonly key: PropertyKey; readonly description: string }>();

  for (const spec of specs) {
    if (spec.placement.kind === "attribute") {
      const name = resolveAttributeName(spec.placement, spec.key);
      if (name === undefined) {
        return `Xml.Struct cannot infer an XML name from symbol field ${String(spec.key)}`;
      }
      const key = JSON.stringify(["attribute", name.namespaceUri ?? null, name.localName]);
      const owner = ownership.get(key);
      if (owner !== undefined && owner.key !== spec.key) {
        return `Xml.Struct fields ${String(owner.key)} and ${String(spec.key)} both own XML attribute ${JSON.stringify(codecNameLabel(name))}`;
      }
      ownership.set(key, {
        key: spec.key,
        description: `XML attribute ${JSON.stringify(codecNameLabel(name))}`,
      });
      continue;
    }

    const resolved = resolveFieldChildren(spec, resolveSuspended);
    if (resolved.error !== undefined) return resolved.error;
    if (resolveSuspended && !resolved.complete) {
      return `Xml.Struct field ${String(spec.key)} has unresolved recursive XML child placement`;
    }
    const own = new Set<string>();
    for (const placement of resolved.placements) {
      const key = ownershipKey(placement);
      if (own.has(key)) continue;
      own.add(key);
      const owner = ownership.get(key);
      if (owner !== undefined && owner.key !== spec.key) {
        return `Xml.Struct fields ${String(owner.key)} and ${String(spec.key)} both own ${ownershipDescription(placement)}`;
      }
      ownership.set(key, {
        key: spec.key,
        description: ownershipDescription(placement),
      });
    }
  }
  return undefined;
};

const provideBindings = <Value, Error, Services>(
  bindings: ReadonlyArray<{
    readonly token: PlacementToken;
    readonly name: ResolvedCodecName;
  }>,
  effect: Effect.Effect<Value, Error, Services>,
) => {
  let provided = effect;
  for (let index = bindings.length - 1; index >= 0; index--) {
    const binding = bindings[index]!;
    const inner = provided;
    provided = Effect.flatMap(PlacementBindings, (parent) =>
      Effect.provideService(inner, PlacementBindings, { parent, ...binding }),
    );
  }
  return provided;
};

const provideFieldNames = <Value, Error, Services>(
  spec: FieldSpec,
  effect: Effect.Effect<Value, Error, Services>,
) =>
  Effect.suspend(() => {
    if (spec.placement.kind === "attribute") {
      const name = resolveAttributeName(spec.placement, spec.key);
      return name === undefined || spec.placement.name.localName !== undefined
        ? effect
        : provideBindings([{ token: spec.placement.token, name }], effect);
    }
    const resolved = resolveFieldChildren(spec, true);
    const bindings: Array<{ readonly token: PlacementToken; readonly name: ResolvedCodecName }> =
      [];
    for (const placement of resolved.placements) {
      if (placement.kind === "element" && placement.placement.name.localName === undefined) {
        bindings.push({ token: placement.placement.token, name: placement.name });
      }
    }
    return provideBindings(bindings, effect);
  });

const bindFieldNames = (field: StructField, spec: FieldSpec): StructField =>
  delegate(
    field,
    (effect) => provideFieldNames(spec, effect),
    (effect) => provideFieldNames(spec, effect),
  );

const needsFieldNameBinding = (spec: FieldSpec) => {
  if (spec.placement.kind === "attribute") return spec.placement.name.localName === undefined;
  const resolved = resolveFieldChildren(spec, false);
  return (
    !resolved.complete ||
    resolved.placements.some(
      (placement) =>
        placement.kind === "element" && placement.placement.name.localName === undefined,
    )
  );
};

const duplicateIssue = (
  key: PropertyKey,
  description: string,
  input: ReadonlyArray<Child | undefined>,
  options: SchemaAST.ParseOptions,
) =>
  new SchemaIssue.Pointer(
    [key],
    new SchemaIssue.InvalidValue({ message: `Duplicate known ${description}` }, input, options),
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

const matchesChild = (child: Child, placement: OwnedChildPlacement) => {
  if (placement.kind === "element") {
    return isElement(child) && hasExpandedName(child.name, placement.name);
  }
  if (placement.kind === "text") return isText(child);
  if (placement.kind === "cdata") return isCData(child);
  if (placement.kind === "comment") return isComment(child);
  return isProcessingInstruction(child) && child.target === placement.target;
};

/** Maps unordered attributes and child-node fields through a standard Effect Struct. */
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

  for (const key of Reflect.ownKeys(fields)) {
    const field = fields[key]!;
    const placement = getPlacement(field);
    if (
      placement === undefined ||
      placement.kind === "struct" ||
      placement.kind === "document" ||
      placement.kind === "tuple"
    ) {
      throw new Error(`Xml.Struct field ${String(key)} has no compatible XML placement`);
    }
    const spec: FieldSpec = { key, placement, optional: encodedOptional(field) };
    specs.push(spec);
    if (needsFieldNameBinding(spec)) {
      boundFields[key] = bindFieldNames(field, spec);
    } else {
      boundFields[key] = field;
    }
  }

  const conflict = ownershipConflict(specs, false);
  if (conflict !== undefined) throw new Error(conflict);

  const optionalBareArraySpecs = specs.filter(
    (spec) => spec.optional && spec.placement.kind === "array",
  );
  const structured = specs.every((spec) => {
    if (spec.placement.kind === "attribute") return true;
    const resolved = resolveFieldChildren(spec, false);
    return (
      resolved.complete && resolved.placements.every((placement) => placement.kind === "element")
    );
  });
  const fieldSchema = guardProduct(Schema.Struct(boundFields));
  const raw = encoded(isElementContent, { kind: "struct", structured });
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
          const dynamicConflict = ownershipConflict(specs, true);
          if (dynamicConflict !== undefined) {
            return Effect.fail(
              new SchemaIssue.InvalidValue({ message: dynamicConflict }, content, options),
            );
          }
          return Effect.flatMap(CurrentDecodeState, (state) =>
            Effect.flatMap(CurrentStructDecodeIssues, (scope) => {
              const output: Record<
                PropertyKey,
                Attribute | Child | ReadonlyArray<Child> | undefined
              > = Object.create(null);
              const contentChildren = canonicalizeOrderedChildren(content.children, state);
              const projected = new Map<PropertyKey, ProjectedNode>();
              const attributes = new Set<number>();
              const children = new Set<number>();
              const preservesSpace =
                content.element === undefined ? false : registerXmlSpace(state, content.element);

              for (let index = 0; index < content.attributes.length; index++) {
                const attribute = content.attributes[index];
                if (attribute !== undefined && isXmlSpaceAttribute(attribute)) {
                  attributes.add(index);
                }
              }

              for (const spec of specs) {
                if (spec.placement.kind === "attribute") {
                  const name = resolveAttributeName(spec.placement, spec.key)!;
                  const matches: Array<number> = [];
                  for (let index = 0; index < content.attributes.length; index++) {
                    const attribute = content.attributes[index];
                    if (attribute !== undefined && hasExpandedName(attribute.name, name)) {
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
                    const issue = new SchemaIssue.Pointer(
                      [spec.key],
                      new SchemaIssue.InvalidValue(
                        {
                          message: `Duplicate known XML attribute ${JSON.stringify(codecNameLabel(name))}`,
                        },
                        matches.map((index) => content.attributes[index]),
                        options,
                      ),
                    );
                    scope?.issues.push(issue);
                    if (scope !== undefined) scope.input = content;
                  }
                  continue;
                }

                const resolved = resolveFieldChildren(spec, true);
                const matches: Array<number> = [];
                for (let index = 0; index < contentChildren.length; index++) {
                  const child = contentChildren[index];
                  if (
                    child !== undefined &&
                    resolved.placements.some((placement) => matchesChild(child, placement))
                  ) {
                    matches.push(index);
                  }
                }

                if (spec.placement.kind === "array") {
                  const values: Array<Child> = [];
                  for (const index of matches) {
                    const child = contentChildren[index]!;
                    values.push(child);
                    if (isElement(child)) registerXmlSpace(state, child, preservesSpace);
                  }
                  output[spec.key] = values;
                  projected.set(spec.key, values);
                  for (const index of matches) children.add(index);
                } else {
                  const first = matches[0];
                  if (first !== undefined) {
                    const child = contentChildren[first]!;
                    output[spec.key] = child;
                    projected.set(spec.key, child);
                    if (isElement(child)) registerXmlSpace(state, child, preservesSpace);
                    for (const index of matches) children.add(index);
                  }
                  if (matches.length > 1) {
                    const description =
                      resolved.placements.length === 1
                        ? ownershipDescription(resolved.placements[0]!)
                        : "XML child content";
                    const issue = duplicateIssue(
                      spec.key,
                      description,
                      matches.map((index) => contentChildren[index]),
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
              for (let index = 0; index < contentChildren.length; index++) {
                if (children.has(index)) continue;
                const child = contentChildren[index]!;
                if (isText(child) && !preservesSpace && isXmlWhitespace(child.value)) continue;
                let description = "XML content";
                if (isElement(child)) description = child.name.qualifiedName;
                else if (isText(child)) description = "Text";
                output[Symbol(`XML child ${description} ${index}`)] = child;
              }

              if (state !== undefined && content.element !== undefined) {
                state.projections.set(content.element, projected);
              }
              // Symbol keys are intentional unknown properties for Struct excess handling
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
          const dynamicConflict = ownershipConflict(specs, true);
          if (dynamicConflict !== undefined) {
            return Effect.fail(
              new SchemaIssue.InvalidValue({ message: dynamicConflict }, values, options),
            );
          }
          return Effect.flatMap(CurrentEncodeState, (state) => {
            const attributes: Array<{ readonly key: PropertyKey; readonly value: Attribute }> = [];
            const children: Array<Child> = [];
            const issues: Array<SchemaIssue.Issue> = [];
            const encodedValues = values as {
              readonly [Key in keyof Fields]?: Fields[Key]["Encoded"];
            };

            for (const spec of specs) {
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
              } else if (spec.placement.kind === "array") {
                if (globalThis.Array.isArray(value) && value.every(isChild)) {
                  for (const child of value) children.push(child);
                } else {
                  issues.push(
                    new SchemaIssue.Pointer(
                      [spec.key],
                      new SchemaIssue.InvalidValue(
                        { message: "Expected encoded XML children" },
                        value,
                        options,
                      ),
                    ),
                  );
                }
              } else if (isChild(value)) {
                children.push(value);
              } else {
                issues.push(
                  new SchemaIssue.Pointer(
                    [spec.key],
                    new SchemaIssue.InvalidValue(
                      { message: "Expected one encoded XML child" },
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
            return Effect.map(
              validateOrderedChildren(children, fieldSchema.ast, options),
              (validChildren) => ({
                attributes: attributes.map(({ value }) => value),
                children: validChildren,
              }),
            );
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

  return delegateRequired(
    codec,
    (effect, options) => withStructuralIssues(effect, options),
    (effect) => effect,
  ) as Schema.Codec<
    Schema.Struct.Type<Fields>,
    ElementContent,
    Schema.Struct.DecodingServices<Fields>,
    Schema.Struct.EncodingServices<Fields>
  >;
};
