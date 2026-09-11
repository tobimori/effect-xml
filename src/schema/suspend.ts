import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaParser from "effect/SchemaParser";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { lazy, type Lazy } from "./lazy.ts";
import {
  getPlacement,
  placementAnnotations,
  type Placement,
  type SuspendPlacement,
} from "./metadata.ts";

/** A suspended XML codec with an Effect boundary for recursive execution. */
export type Suspend<S extends Schema.Constraint> = Schema.Codec<
  S["Type"],
  S["Encoded"],
  S["DecodingServices"],
  S["EncodingServices"]
>;

const encodedBoundary = <S extends Schema.Constraint>(get: () => S, placement: Placement) => {
  const parameter = Schema.suspend(() => Schema.toEncoded(get()));
  const original = parameter.ast;
  const flipped = SchemaAST.flip(original);
  // Implements the projection-aware encoded declaration parser
  const projectedRun =
    (passthrough: SchemaAST.AST): SchemaAST.Declaration["run"] =>
    ([projected]) => {
      if (projected === passthrough) return (input) => Effect.succeed(input);
      const codec = Schema.make(projected!) as Schema.Codec<unknown, unknown>;
      const parse = SchemaParser.decodeUnknownEffect(codec);
      return (input, _ast, options) => Effect.suspend(() => parse(input, options));
    };
  const declaration = new SchemaAST.Declaration(
    [original],
    projectedRun(original),
    placementAnnotations(placement),
    undefined,
    undefined,
    undefined,
    undefined,
    projectedRun(flipped),
  );
  return Schema.make(declaration) as Schema.Codec<S["Encoded"], S["Encoded"]>;
};

/** Defers a recursive XML codec without evaluating its thunk during placement discovery. */
export const suspend = <S extends Schema.Constraint>(thunk: () => S): Suspend<S> => {
  let schema: S | undefined;
  const get = () => (schema ??= thunk());
  const placement: SuspendPlacement = {
    kind: "suspend",
    resolve: () => getPlacement(get()),
  };
  const core: Lazy<S> = lazy(get);
  return encodedBoundary(get, placement).pipe(
    Schema.decodeTo(
      core,
      SchemaTransformation.transform<S["Encoded"], S["Encoded"]>({
        decode: (value) => value,
        encode: (value) => value,
      }),
    ),
  );
};
