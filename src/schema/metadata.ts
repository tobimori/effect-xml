import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";

import type { Attribute } from "../ast/attribute.ts";
import type { Child, Element } from "../ast/element.ts";
import type { CodecName } from "./codec-name.ts";

const PlacementAnnotation = "effect-xml/placement";

export interface PlacementToken {}

export type Placement =
  | {
      readonly kind: "attribute";
      readonly name: CodecName;
      readonly token: PlacementToken;
    }
  | {
      readonly kind: "element";
      readonly name: CodecName;
      readonly token: PlacementToken;
      readonly structured: boolean;
    }
  | {
      readonly kind: "array";
      readonly item: ElementPlacement;
    }
  | { readonly kind: "struct" }
  | { readonly kind: "document" };

export type ElementPlacement = Extract<Placement, { readonly kind: "element" }>;

export interface ElementContent {
  readonly element?: Element;
  readonly attributes: ReadonlyArray<Attribute>;
  readonly children: ReadonlyArray<Child>;
}

export type Encodes<A> = Schema.Constraint & { readonly Encoded: A };
export type StructField = Encodes<Attribute | Element | ReadonlyArray<Element> | undefined>;
export type ArrayItem = Encodes<Element>;
export type FragmentContent = Encodes<Child | ReadonlyArray<Child> | undefined>;
export type DocumentRoot = Encodes<Element>;

/** Adds XML placement to the final encoded AST of a declaration. */
export const encoded = <A>(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the Schema.declare parsing boundary.
  is: (input: unknown) => input is A,
  placement: Placement,
): Schema.declare<A> => Schema.declare(is, { [PlacementAnnotation]: placement });

/** Retains String as the structural encoded leaf while attaching XML placement. */
export const encodedString = (placement: Placement) =>
  Schema.String.annotate({ [PlacementAnnotation]: placement });

const annotationPlacement = (ast: SchemaAST.AST): Placement | undefined => {
  const value = ast.annotations?.[PlacementAnnotation];
  if (!Predicate.isObject(value) || !Predicate.hasProperty(value, "kind")) return undefined;
  if (
    value.kind !== "attribute" &&
    value.kind !== "element" &&
    value.kind !== "array" &&
    value.kind !== "struct" &&
    value.kind !== "document"
  ) {
    return undefined;
  }
  return value as Placement;
};

/** Resolves XML placement through public encoded AST links. */
export const getPlacement = (schema: Schema.Constraint): Placement | undefined => {
  const seen = new Set<SchemaAST.AST>();

  const visit = (ast: SchemaAST.AST): Placement | undefined => {
    if (seen.has(ast)) return undefined;
    seen.add(ast);

    const encodedAst = SchemaAST.toEncoded(ast);
    const placement = annotationPlacement(encodedAst);
    if (placement !== undefined) return placement;

    if (SchemaAST.isSuspend(encodedAst)) return visit(encodedAst.thunk());
    if (SchemaAST.isDeclaration(encodedAst) && encodedAst.typeParameters.length === 1) {
      return visit(encodedAst.typeParameters[0]!);
    }
    if (SchemaAST.isUnion(encodedAst)) {
      const members = encodedAst.types.filter((member) => !SchemaAST.isUndefined(member));
      return members.length === 1 ? visit(members[0]!) : undefined;
    }
    return undefined;
  };

  return visit(schema.ast);
};

/** Reports whether the final encoded boundary accepts a standalone undefined value. */
export const acceptsEncodedUndefined = (schema: Schema.Constraint) => {
  const seen = new Set<SchemaAST.AST>();

  const visit = (ast: SchemaAST.AST): boolean => {
    if (seen.has(ast)) return false;
    seen.add(ast);

    const encodedAst = SchemaAST.toEncoded(ast);
    if (SchemaAST.isUndefined(encodedAst)) return true;
    if (SchemaAST.isSuspend(encodedAst)) return visit(encodedAst.thunk());
    if (SchemaAST.isDeclaration(encodedAst) && encodedAst.typeParameters.length === 1) {
      return visit(encodedAst.typeParameters[0]!);
    }
    return SchemaAST.isUnion(encodedAst) && encodedAst.types.some(visit);
  };

  return visit(schema.ast);
};

export const isElementContent = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the Schema.declare parsing boundary.
  input: unknown,
): input is ElementContent =>
  Predicate.isObject(input) &&
  Predicate.hasProperty(input, "attributes") &&
  globalThis.Array.isArray(input.attributes) &&
  Predicate.hasProperty(input, "children") &&
  globalThis.Array.isArray(input.children);
