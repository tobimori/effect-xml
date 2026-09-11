import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { isText, Text as TextNode } from "../ast/text.ts";
import { encoded } from "./metadata.ts";
import { scalar, validateXmlCharacters } from "./scalar.ts";

/** Places one scalar value in one ordinary XML text node. */
export const Text = <S extends Schema.Constraint>(
  schema: S,
): Schema.Codec<S["Type"], TextNode, S["DecodingServices"], S["EncodingServices"]> =>
  encoded(
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the text-node boundary.
    (input): input is TextNode => isText(input),
    { kind: "text" },
  ).pipe(
    Schema.decodeTo(
      scalar(schema),
      SchemaTransformation.transformEffect<string, TextNode>({
        decode: (text) => Effect.succeed(text.value),
        encode: (value, options) =>
          Effect.map(
            validateXmlCharacters(value, "XML text", options),
            (valid) => new TextNode({ value: valid }),
          ),
      }),
    ),
  );
