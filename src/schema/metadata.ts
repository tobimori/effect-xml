import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";

import type { Attribute } from "../ast/attribute.ts";
import type { Child, Element } from "../ast/element.ts";
import type { CodecName } from "./codec-name.ts";
import type { Rest } from "./rest.ts";

const PlacementAnnotation = "effect-xml/placement";

export interface PlacementToken {}

export interface AttributePlacement {
  readonly kind: "attribute";
  readonly name: CodecName;
  readonly token: PlacementToken;
}

export interface ElementPlacement {
  readonly kind: "element";
  readonly name: CodecName;
  readonly token: PlacementToken;
  readonly structured: boolean;
}

export interface TextPlacement {
  readonly kind: "text";
}

export interface CDataPlacement {
  readonly kind: "cdata";
}

export interface CommentPlacement {
  readonly kind: "comment";
}

export interface ProcessingInstructionPlacement {
  readonly kind: "processing-instruction";
  readonly target: string;
}

export interface UnionPlacement {
  readonly kind: "union";
  readonly members: ReadonlyArray<SingleChildPlacement>;
}

export interface SuspendPlacement {
  readonly kind: "suspend";
  readonly resolve: () => Placement | undefined;
}

export interface RestPlacement {
  readonly kind: "rest";
}

export type ConcreteChildPlacement =
  | ElementPlacement
  | TextPlacement
  | CDataPlacement
  | CommentPlacement
  | ProcessingInstructionPlacement;

export type SingleChildPlacement = ConcreteChildPlacement | UnionPlacement | SuspendPlacement;

export interface ArrayPlacement {
  readonly kind: "array";
  readonly item: SingleChildPlacement;
}

export interface TuplePlacement {
  readonly kind: "tuple";
  readonly items: ReadonlyArray<SingleChildPlacement>;
}

export type Placement =
  | AttributePlacement
  | SingleChildPlacement
  | ArrayPlacement
  | TuplePlacement
  | RestPlacement
  | { readonly kind: "struct"; readonly structured: boolean }
  | { readonly kind: "document" };

export interface ElementContent {
  readonly element?: Element;
  readonly attributes: ReadonlyArray<Attribute>;
  readonly children: ReadonlyArray<Child>;
}

export type Encodes<A> = Schema.Constraint & { readonly Encoded: A };
export type StructField = Encodes<Attribute | Child | ReadonlyArray<Child> | Rest | undefined>;
export type ArrayItem = Encodes<Child>;
export type TupleItem = Encodes<Child>;
export type UnionMember = Encodes<Child>;
export type FragmentContent = Encodes<Child | ReadonlyArray<Child> | undefined>;
export type DocumentRoot = Encodes<Element>;

/** Produces the declaration annotation used by XML-aware lazy boundaries. */
export const placementAnnotations = (placement: Placement) => ({
  [PlacementAnnotation]: placement,
});

/** Adds XML placement to the final encoded AST of a declaration. */
export const encoded = <A>(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the Schema.declare parsing boundary.
  is: (input: unknown) => input is A,
  placement: Placement,
): Schema.declare<A> => Schema.declare(is, placementAnnotations(placement));

/** Retains String as the structural encoded leaf while attaching XML placement. */
export const encodedString = (placement: Placement) =>
  Schema.String.annotate(placementAnnotations(placement));

/** Attaches XML placement without adding another validation or transformation boundary. */
export const withPlacement = <S extends Schema.Top>(
  schema: S,
  placement: Placement,
): S["Rebuild"] => schema.pipe(Schema.annotateEncoded(placementAnnotations(placement)));

const annotationPlacement = (ast: SchemaAST.AST): Placement | undefined => {
  const value = ast.annotations?.[PlacementAnnotation];
  if (!Predicate.isObject(value) || !Predicate.hasProperty(value, "kind")) return undefined;
  if (
    value.kind !== "attribute" &&
    value.kind !== "element" &&
    value.kind !== "text" &&
    value.kind !== "cdata" &&
    value.kind !== "comment" &&
    value.kind !== "processing-instruction" &&
    value.kind !== "array" &&
    value.kind !== "tuple" &&
    value.kind !== "union" &&
    value.kind !== "suspend" &&
    value.kind !== "rest" &&
    value.kind !== "struct" &&
    value.kind !== "document"
  ) {
    return undefined;
  }
  return value as Placement;
};

/** Resolves XML placement through public encoded AST links without forcing suspensions. */
export const getPlacement = (schema: Schema.Constraint): Placement | undefined => {
  const seen = new Set<SchemaAST.AST>();

  const visit = (ast: SchemaAST.AST): Placement | undefined => {
    if (seen.has(ast)) return undefined;
    seen.add(ast);

    const encodedAst = SchemaAST.toEncoded(ast);
    const placement = annotationPlacement(encodedAst);
    if (placement !== undefined) return placement;

    if (SchemaAST.isSuspend(encodedAst)) return undefined;
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

export const isSingleChildPlacement = (placement: Placement): placement is SingleChildPlacement =>
  placement.kind === "element" ||
  placement.kind === "text" ||
  placement.kind === "cdata" ||
  placement.kind === "comment" ||
  placement.kind === "processing-instruction" ||
  placement.kind === "union" ||
  placement.kind === "suspend";

export interface ChildPlacementResolution {
  readonly placements: ReadonlyArray<ConcreteChildPlacement>;
  readonly complete: boolean;
}

/** Flattens union and lazy child placement only when execution explicitly requests it. */
export const resolveChildPlacements = (
  placement: SingleChildPlacement,
  resolveSuspended: boolean,
) => {
  interface Work {
    readonly placement?: SingleChildPlacement;
    readonly exit?: SuspendPlacement;
  }

  const placements: Array<ConcreteChildPlacement> = [];
  const work: Array<Work> = [{ placement }];
  const activeSuspensions = new Set<SuspendPlacement>();
  let complete = true;

  while (work.length > 0) {
    const current = work.pop()!;
    if (current.exit !== undefined) {
      activeSuspensions.delete(current.exit);
      continue;
    }
    const child = current.placement!;
    if (child.kind === "union") {
      for (let index = child.members.length - 1; index >= 0; index--) {
        work.push({ placement: child.members[index]! });
      }
      continue;
    }
    if (child.kind === "suspend") {
      if (!resolveSuspended || activeSuspensions.has(child)) {
        complete = false;
        continue;
      }
      const resolved = child.resolve();
      if (resolved === undefined || !isSingleChildPlacement(resolved)) {
        complete = false;
      } else {
        activeSuspensions.add(child);
        work.push({ exit: child }, { placement: resolved });
      }
      continue;
    }
    placements.push(child);
  }

  return { placements, complete };
};

/** Resolves only transparent suspension aliases, leaving unions and content operators intact. */
export const resolveSuspendedPlacement = (placement: Placement) => {
  const active = new Set<SuspendPlacement>();
  let current: Placement | undefined = placement;
  while (current?.kind === "suspend") {
    if (active.has(current)) return undefined;
    active.add(current);
    current = current.resolve();
  }
  return current;
};

/** Reports whether the final encoded boundary accepts a standalone undefined value. */
export const acceptsEncodedUndefined = (schema: Schema.Constraint) => {
  const seen = new Set<SchemaAST.AST>();

  const visit = (ast: SchemaAST.AST): boolean => {
    if (seen.has(ast)) return false;
    seen.add(ast);

    const encodedAst = SchemaAST.toEncoded(ast);
    if (SchemaAST.isUndefined(encodedAst)) return true;
    if (SchemaAST.isSuspend(encodedAst)) return false;
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
