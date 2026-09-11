import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { Comment as CommentNode, isComment } from "../ast/comment.ts";
import { encoded } from "./metadata.ts";
import { scalar, validateXmlCharacters } from "./scalar.ts";

/** Places one scalar value in one XML comment node. */
export const Comment = <S extends Schema.Constraint>(
  schema: S,
): Schema.Codec<S["Type"], CommentNode, S["DecodingServices"], S["EncodingServices"]> =>
  encoded(
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the comment-node boundary.
    (input): input is CommentNode => isComment(input),
    { kind: "comment" },
  ).pipe(
    Schema.decodeTo(
      scalar(schema),
      SchemaTransformation.transformEffect<string, CommentNode>({
        decode: (comment) => Effect.succeed(comment.value),
        encode: (value, options) =>
          Effect.flatMap(validateXmlCharacters(value, "XML comment", options), (valid) => {
            if (!valid.includes("--") && !valid.endsWith("-")) {
              return Effect.succeed(new CommentNode({ value: valid }));
            }
            return Effect.fail(
              new SchemaIssue.InvalidValue(
                { message: "XML comment data must not contain '--' or end with '-'" },
                value,
                options,
              ),
            );
          }),
      }),
    ),
  );
