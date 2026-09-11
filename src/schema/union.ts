import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { isComment } from "../ast/comment.ts";
import { isElement, type Child } from "../ast/element.ts";
import { isProcessingInstruction } from "../ast/processing-instruction.ts";
import { isCData, isText } from "../ast/text.ts";
import { hasExpandedName, resolvedCodecName } from "./codec-name.ts";
import { PlacementBindings, resolvePlacementName } from "./context.ts";
import {
  encoded,
  getPlacement,
  isSingleChildPlacement,
  resolveChildPlacements,
  type ConcreteChildPlacement,
  type SingleChildPlacement,
  type UnionMember,
} from "./metadata.ts";
import { isOrderedChild } from "./ordered-content.ts";

type UnionMembers = ReadonlyArray<UnionMember>;

const matchesConcretePlacement = (
  child: Child,
  placement: ConcreteChildPlacement,
  bindings: typeof PlacementBindings.Service,
) => {
  if (placement.kind === "text") return isText(child);
  if (placement.kind === "cdata") return isCData(child);
  if (placement.kind === "comment") return isComment(child);
  if (placement.kind === "processing-instruction") {
    return isProcessingInstruction(child) && child.target === placement.target;
  }
  if (!isElement(child)) return false;
  const name = resolvedCodecName(placement.name) ?? resolvePlacementName(bindings, placement.token);
  return name === undefined ? undefined : hasExpandedName(child.name, name);
};

/** A small structural precondition which leaves the original member as the composed Type AST. */
const placementGuard = (placement: SingleChildPlacement) =>
  Schema.declareConstructor<Child>()([], () => (input, ast, options) => {
    if (!isOrderedChild(input)) {
      return Effect.fail(new SchemaIssue.InvalidType(ast, input, options));
    }
    return Effect.flatMap(PlacementBindings, (bindings) => {
      const resolution = resolveChildPlacements(placement, true);
      let indeterminate = !resolution.complete;
      for (const concrete of resolution.placements) {
        const match = matchesConcretePlacement(input, concrete, bindings);
        if (match === true) return Effect.succeed(input);
        if (match === undefined) indeterminate = true;
      }
      return indeterminate
        ? Effect.succeed(input)
        : Effect.fail(new SchemaIssue.InvalidType(ast, input, options));
    });
  });

const prependPlacementGuard = (member: UnionMember, placement: SingleChildPlacement) =>
  placementGuard(placement).pipe(
    Schema.decodeTo(
      member,
      SchemaTransformation.transform<Child, Child>({
        decode: (child) => child,
        encode: (child) => child,
      }),
    ),
  );

/** Selects the first successful XML child codec in declaration order. */
export const Union = <const Members extends UnionMembers>(
  members: Members,
): Schema.Codec<
  Schema.Union<Members>["Type"],
  Schema.Union<Members>["Encoded"],
  Schema.Union<Members>["DecodingServices"],
  Schema.Union<Members>["EncodingServices"]
> => {
  const placements: Array<SingleChildPlacement> = [];
  for (const member of members) {
    const placement = getPlacement(member);
    if (placement === undefined || !isSingleChildPlacement(placement)) {
      throw new Error("Xml.Union requires single XML child codecs with retained placement");
    }
    placements.push(placement);
  }
  const raw = encoded(isOrderedChild, { kind: "union", members: placements });
  const guarded = members.map((member, index) => prependPlacementGuard(member, placements[index]!));
  return raw.pipe(
    Schema.decodeTo(
      Schema.Union(guarded),
      SchemaTransformation.transform<
        Schema.Union<Members>["Encoded"],
        Schema.Union<Members>["Encoded"]
      >({
        decode: (child) => child,
        encode: (child) => child,
      }),
    ),
  );
};
