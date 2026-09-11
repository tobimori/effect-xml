import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HashSet from "effect/HashSet";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaParser from "effect/SchemaParser";

interface IdentityValue {}

interface Ids {
  readonly values: WeakMap<IdentityValue, number>;
  next: number;
}

interface ParsePath {
  readonly ids: Ids;
  readonly active: HashSet.HashSet<number>;
}

const CurrentParsePath = Context.Reference<ParsePath | undefined>(
  "effect-xml/schema/CurrentParsePath",
  { defaultValue: () => undefined },
);

export const guardParsePath = <A, R>(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The guarded product parser validates this boundary input.
  input: unknown,
  effect: Effect.Effect<A, SchemaIssue.Issue, R>,
  options: import("effect/SchemaAST").ParseOptions,
) =>
  Effect.flatMap(CurrentParsePath, (inherited) => {
    if (!Predicate.isObjectKeyword(input)) return effect;
    const path: ParsePath = inherited ?? {
      ids: { values: new WeakMap(), next: 0 },
      active: HashSet.empty(),
    };
    let id = path.ids.values.get(input);
    if (id === undefined) {
      id = path.ids.next++;
      path.ids.values.set(input, id);
    }
    if (HashSet.has(path.active, id)) {
      return Effect.fail(
        new SchemaIssue.InvalidValue({ message: "Cyclic XML schema value" }, input, options),
      );
    }
    return Effect.provideService(effect, CurrentParsePath, {
      ids: path.ids,
      active: HashSet.add(path.active, id),
    });
  });

const isActive = (path: ParsePath, input: IdentityValue) => {
  const id = path.ids.values.get(input);
  return id !== undefined && HashSet.has(path.active, id);
};

/** Rejects an array or tuple item that points back to an active ancestor product. */
export const guardDescent = <S extends Schema.Constraint>(
  schema: S,
): Schema.Codec<S["Type"], S["Encoded"], S["DecodingServices"], S["EncodingServices"]> =>
  Schema.declareConstructor<S["Type"], S["Encoded"]>()(
    [Schema.suspend(() => schema)],
    ([codec]) => {
      const parse = SchemaParser.decodeUnknownEffect(codec);
      return (input, _ast, options) =>
        Effect.flatMap(CurrentParsePath, (path) => {
          if (path !== undefined && Predicate.isObjectKeyword(input) && isActive(path, input)) {
            return Effect.fail(
              new SchemaIssue.InvalidValue({ message: "Cyclic XML schema value" }, input, options),
            );
          }
          return Effect.suspend(() => parse(input, options));
        });
    },
  );

/** Adds path-local cycle detection exactly where a product parser descends into its data. */
export const guardProduct = <S extends Schema.Constraint>(
  schema: S,
): Schema.Codec<S["Type"], S["Encoded"], S["DecodingServices"], S["EncodingServices"]> =>
  Schema.declareConstructor<S["Type"], S["Encoded"]>()(
    [Schema.suspend(() => schema)],
    ([codec]) => {
      const parse = SchemaParser.decodeUnknownEffect(codec);
      return (input, _ast, options) =>
        guardParsePath(
          input,
          Effect.suspend(() => parse(input, options)),
          options,
        );
    },
  );
