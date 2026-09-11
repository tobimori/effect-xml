import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { isXmlChar } from "../parser/character.ts";
import { CurrentEncodeState } from "./context.ts";

/** Validates typed scalar output before its field path is lost at serialization. */
export const validateXmlCharacters = (
  value: string,
  context: string,
  options: SchemaAST.ParseOptions,
) =>
  Effect.flatMap(CurrentEncodeState, (state) => {
    const version = state?.version ?? "1.0";
    let offset = 0;
    while (offset < value.length) {
      const codePoint = value.codePointAt(offset);
      if (codePoint === undefined || !isXmlChar(codePoint, version)) {
        const label = `U+${(codePoint ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
        return Effect.fail(
          new SchemaIssue.InvalidValue(
            {
              message: `${context} contains an invalid XML ${version} character ${label} at UTF-16 offset ${offset}`,
            },
            value,
            options,
          ),
        );
      }
      offset += codePoint > 0xffff ? 2 : 1;
    }
    return Effect.succeed(value);
  });

/** Derives the canonical Effect string-leaf codec used by XML scalar content. */
// RETURN TYPE: Narrows StringTree to the required string leaf while retaining service sets.
export const scalar = <S extends Schema.Constraint>(
  schema: S,
): Schema.Codec<S["Type"], string, S["DecodingServices"], S["EncodingServices"]> => {
  try {
    const canonical = Schema.toCodecStringTree(schema);
    return Schema.String.pipe(
      Schema.decodeTo(
        canonical,
        SchemaTransformation.transformEffect<Schema.StringTree, string>({
          decode: (value) => Effect.succeed(value),
          encode: (value, options) =>
            Predicate.isString(value)
              ? Effect.succeed(value)
              : Effect.fail(
                  new SchemaIssue.InvalidValue(
                    { message: "Expected a scalar schema with a string-leaf representation" },
                    value,
                    options,
                  ),
                ),
        }),
      ),
    );
  } catch (error) {
    if (
      !(error instanceof globalThis.Error) ||
      error.message !== "Missing structural codec for StringTree"
    ) {
      throw error;
    }
    return Schema.String.pipe(
      Schema.decodeTo(
        schema,
        SchemaTransformation.transformEffect<S["Encoded"], string>({
          decode: (value, options) =>
            Effect.fail(
              new SchemaIssue.InvalidValue(
                { message: "Expected a scalar schema with a string-leaf representation" },
                value,
                options,
              ),
            ),
          encode: (value, options) =>
            Effect.fail(
              new SchemaIssue.InvalidValue(
                { message: "Expected a scalar schema with a string-leaf representation" },
                value,
                options,
              ),
            ),
        }),
      ),
    );
  }
};
