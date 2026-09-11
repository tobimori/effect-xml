import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import type * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaParser from "effect/SchemaParser";
import * as SchemaTransformation from "effect/SchemaTransformation";

export interface Delegate {
  <A, R>(
    effect: Effect.Effect<A, SchemaIssue.Issue, R>,
    options: SchemaAST.ParseOptions,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The delegated schema parses this boundary input.
    input: unknown,
  ): Effect.Effect<A, SchemaIssue.Issue, R>;
}

// Implements Effect's declaration parser factory while retaining projected AST identity
const makeRun =
  (original: SchemaAST.AST, delegate: Delegate): SchemaAST.Declaration["run"] =>
  ([projected]) => {
    const codec = Schema.make(projected!) as Schema.Codec<unknown, unknown>;
    const parse = SchemaParser.decodeUnknownEffect(codec);
    return projected === original
      ? (input, _ast, options) => delegate(parse(input, options), options, input)
      : (input, _ast, options) => parse(input, options);
  };

/** Intercepts a complete required boundary without appending a second parser for its result. */
export const delegateRequired = <S extends Schema.Constraint>(
  schema: S,
  decoding: Delegate,
  encoding: Delegate,
): Schema.Codec<S["Type"], S["Encoded"], S["DecodingServices"], S["EncodingServices"]> => {
  const flipped = SchemaAST.flip(schema.ast);
  const declaration = new SchemaAST.Declaration(
    [schema.ast],
    makeRun(schema.ast, decoding),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    makeRun(flipped, encoding),
  );
  return Schema.make(declaration) as Schema.Codec<
    S["Type"],
    S["Encoded"],
    S["DecodingServices"],
    S["EncodingServices"]
  >;
};

const projectionBoundary = (projection: Schema.Constraint) => {
  const parameter = Schema.suspend(() => projection);
  const original = parameter.ast;
  const flipped = SchemaAST.flip(original);
  // Implements a projection-aware passthrough declaration
  const run =
    (passthrough: SchemaAST.AST): SchemaAST.Declaration["run"] =>
    ([projected]) => {
      if (projected === passthrough) return (input) => Effect.succeed(input);
      const codec = Schema.make(projected!) as Schema.Codec<unknown, unknown>;
      const parse = SchemaParser.decodeUnknownEffect(codec);
      return (input, _ast, options) => parse(input, options);
    };
  return new SchemaAST.Declaration(
    [original],
    run(original),
    projection.ast.annotations,
    undefined,
    undefined,
    projection.ast.context,
    undefined,
    run(flipped),
  );
};

/** Intercepts both directions while retaining optional keys, defaults, omission, and projections. */
export const delegate = <S extends Schema.Constraint>(
  schema: S,
  decoding: Delegate,
  encoding: Delegate,
): Schema.Codec<S["Type"], S["Encoded"], S["DecodingServices"], S["EncodingServices"]> => {
  const typeProjection = Schema.toType(schema);
  const encodedProjection = Schema.toEncoded(schema);
  const typeBoundary = projectionBoundary(typeProjection);
  const encodedBoundary = projectionBoundary(encodedProjection);
  const decodingMiddleware = new SchemaTransformation.Middleware(
    (effect, options) => decoding(effect, options, undefined),
    (effect) => effect,
  );
  const encodingMiddleware = new SchemaTransformation.Middleware(
    (effect) => effect,
    (effect, options) => encoding(effect, options, undefined),
  );
  const ast = new SchemaAST.Declaration(
    typeBoundary.typeParameters,
    typeBoundary.run,
    typeBoundary.annotations,
    undefined,
    [
      new SchemaAST.Link(schema.ast, decodingMiddleware),
      new SchemaAST.Link(encodedBoundary, encodingMiddleware),
    ],
    typeBoundary.context,
    undefined,
    typeBoundary.encodingRun,
  );
  return Schema.make(ast) as Schema.Codec<
    S["Type"],
    S["Encoded"],
    S["DecodingServices"],
    S["EncodingServices"]
  >;
};
