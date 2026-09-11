import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaParser from "effect/SchemaParser";

/** A suspended schema with an Effect boundary for recursive parsing. */
export type Lazy<S extends Schema.Constraint> = Schema.declareConstructor<
  S["Type"],
  S["Encoded"],
  readonly [Schema.suspend<S>]
>;

/** Defers recursive schema execution without changing its types or services. */
// RETURN TYPE: Exposes the single suspended parameter that preserves service sets
export const lazy = <S extends Schema.Constraint>(thunk: () => S): Lazy<S> =>
  Schema.declareConstructor<S["Type"], S["Encoded"]>()([Schema.suspend(thunk)], ([codec]) => {
    const decode = SchemaParser.decodeUnknownEffect(codec);
    return (input, _ast, options) => Effect.suspend(() => decode(input, options));
  });
