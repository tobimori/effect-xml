import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaParser from "effect/SchemaParser";

import { AttributeSchema, isAttribute, type Attribute as AttributeNode } from "../ast/attribute.ts";
import { isComment } from "../ast/comment.ts";
import { hasElementChildCycle } from "../ast/element-cycle.ts";
import { ChildNode, isElement, type Child, type Element } from "../ast/element.ts";
import { isName } from "../ast/name.ts";
import { isNamespaceDeclaration } from "../ast/namespace-declaration.ts";
import { isProcessingInstruction } from "../ast/processing-instruction.ts";
import { isCData, isText } from "../ast/text.ts";
import { isNamespaceBinding, NamespaceBinding } from "../namespace/binding.ts";
import { isNamespaceContext, NamespaceContext } from "../namespace/context.ts";
import { xmlNamespace } from "../namespace/validation.ts";
import type { XmlNamespaceScope } from "./context.ts";

const PlacementAnnotation = "effect-xml/placement";

/** XML data not claimed by another field in the owning Xml.Struct. */
export interface Rest {
  readonly attributes: ReadonlyArray<AttributeNode>;
  readonly children: ReadonlyArray<Child>;
  readonly namespaces: NamespaceContext;
}

/** Materializes the full effective context only when actual Rest data is decoded. */
export const snapshotRestNamespaces = (
  scope: XmlNamespaceScope,
  snapshots?: WeakMap<XmlNamespaceScope, NamespaceContext>,
): NamespaceContext => {
  const existing = snapshots?.get(scope);
  if (existing !== undefined) return existing;

  const frames: Array<XmlNamespaceScope> = [];
  const seen = new Set<XmlNamespaceScope>();
  let inherited: NamespaceContext | undefined;
  let current: XmlNamespaceScope | undefined = scope;
  while (current !== undefined) {
    if (seen.has(current)) throw new Error("XML namespace scope contains a cycle");
    seen.add(current);
    inherited = snapshots?.get(current);
    if (inherited !== undefined) break;
    frames.push(current);
    current = current.parent;
  }

  const effective = new Map<string | undefined, string>(
    inherited === undefined
      ? [["xml", xmlNamespace]]
      : inherited.bindings.map((binding) => [binding.prefix, binding.namespaceUri]),
  );
  for (let index = frames.length - 1; index >= 0; index--) {
    for (const binding of frames[index]!.bindings) {
      if (binding.prefix === "xml") continue;
      effective.delete(binding.prefix);
      if (binding.namespaceUri !== "") effective.set(binding.prefix, binding.namespaceUri);
    }
  }
  const snapshot = new NamespaceContext({
    bindings: [...effective].map(([prefix, namespaceUri]) =>
      prefix === undefined
        ? new NamespaceBinding({ namespaceUri })
        : new NamespaceBinding({ prefix, namespaceUri }),
    ),
  });
  snapshots?.set(scope, snapshot);
  return snapshot;
};

const RestFields = Schema.Struct({
  attributes: Schema.Array(AttributeSchema),
  children: Schema.Array(ChildNode),
  namespaces: NamespaceContext,
});
const decodeRestFields = SchemaParser.decodeUnknownEffect(RestFields);
const decodeRestFieldsResult = SchemaParser.decodeUnknownResult(RestFields);

const effectiveNamespaceIssue = (context: NamespaceContext) => {
  const first = context.bindings[0];
  if (first?.prefix !== "xml" || first.namespaceUri !== xmlNamespace) {
    return "An effective Rest namespace snapshot must begin with the implicit xml binding";
  }
  for (const binding of context.bindings) {
    if (binding.namespaceUri === "") {
      return "An absent effective namespace binding must be omitted from a Rest snapshot";
    }
  }
  return undefined;
};

const validOriginalAttribute = (attribute: AttributeNode) =>
  isAttribute(attribute) &&
  isName(attribute.name) &&
  attribute.name.qualifiedName ===
    (attribute.name.prefix === undefined
      ? attribute.name.localName
      : `${attribute.name.prefix}:${attribute.name.localName}`);

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the class-identity and cycle-safe Rest boundary.
const originalRestIssue = (input: unknown) => {
  if (
    !Predicate.isObject(input) ||
    !("attributes" in input) ||
    !globalThis.Array.isArray(input["attributes"]) ||
    !("children" in input) ||
    !globalThis.Array.isArray(input["children"]) ||
    !("namespaces" in input) ||
    !isNamespaceContext(input["namespaces"])
  ) {
    return "Expected Rest attributes, children, and namespace context";
  }
  if (!input["attributes"].every(validOriginalAttribute)) {
    return "Rest attributes must retain their XML AST classes";
  }
  if (!input["namespaces"].bindings.every(isNamespaceBinding)) {
    return "Rest namespace bindings must retain their NamespaceBinding class";
  }

  if (hasElementChildCycle(input["children"])) {
    return "Rest child element content contains a cycle";
  }

  const work: Array<unknown> = [...input["children"]];
  const seen = new WeakSet<Element>();
  while (work.length > 0) {
    const child = work.pop()!;
    if (isElement(child)) {
      if (seen.has(child)) continue;
      seen.add(child);
      if (
        !isName(child.name) ||
        child.name.qualifiedName !==
          (child.name.prefix === undefined
            ? child.name.localName
            : `${child.name.prefix}:${child.name.localName}`) ||
        !child.namespaceDeclarations.every(isNamespaceDeclaration) ||
        !child.attributes.every(validOriginalAttribute)
      ) {
        return "Rest child elements must retain their XML AST classes";
      }
      for (let index = child.children.length - 1; index >= 0; index--) {
        work.push(child.children[index]!);
      }
    } else if (
      !isText(child) &&
      !isCData(child) &&
      !isComment(child) &&
      !isProcessingInstruction(child)
    ) {
      return "Rest children must retain their XML AST classes";
    }
  }
  return undefined;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Declaration failures retain the unknown schema input.
const invalidRest = (ast: SchemaAST.AST, input: unknown, options: SchemaAST.ParseOptions) =>
  new SchemaIssue.InvalidType(ast, input, options);

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Rest failures retain their unknown boundary input.
const restIssue = (message: string, input: unknown, options: SchemaAST.ParseOptions) =>
  new SchemaIssue.InvalidValue({ message }, input, options);

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the full Rest declaration boundary.
const validateRest = (input: unknown, ast: SchemaAST.AST, options: SchemaAST.ParseOptions) =>
  Effect.catchDefect(
    Effect.suspend(() => {
      const originalIssue = originalRestIssue(input);
      if (originalIssue !== undefined) return Effect.fail(restIssue(originalIssue, input, options));
      return Effect.flatMap(decodeRestFields(input, options), (decoded) => {
        const namespaceIssue = effectiveNamespaceIssue(decoded.namespaces);
        if (namespaceIssue !== undefined) {
          return Effect.fail(restIssue(namespaceIssue, input, options));
        }
        return Effect.succeed(input as Rest);
      });
    }),
    () => Effect.fail(invalidRest(ast, input, options)),
  );

const restDeclaration = Schema.declareConstructor<Rest>()(
  [],
  () => (input, ast, options) => validateRest(input, ast, options),
  { [PlacementAnnotation]: { kind: "rest" } },
);

/** Refines a value through the complete Rest field schemas without throwing. */
export const isRest = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Rest is a public schema boundary.
  input: unknown,
): input is Rest => {
  try {
    if (originalRestIssue(input) !== undefined) return false;
    const result = decodeRestFieldsResult(input);
    return (
      Result.isSuccess(result) && effectiveNamespaceIssue(result.success.namespaces) === undefined
    );
  } catch {
    return false;
  }
};

/** Explicit Xml.Struct rest field retaining raw order and effective namespace bindings. */
export const Rest: Schema.Codec<Rest, Rest> = restDeclaration;
