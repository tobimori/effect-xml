import * as Schema from "effect/Schema";

import { SourceSpan } from "./location.ts";
import { nodeCodec } from "./node-codec.ts";

const CommentEncoded = Schema.TaggedStruct("Comment", {
  value: Schema.String,
  span: Schema.optionalKey(SourceSpan),
});

type CommentFields = Omit<Schema.Schema.Type<typeof CommentEncoded>, "_tag">;

/** An XML comment. Grammar validation belongs to parsing and serialization. */
export class Comment {
  readonly _tag = "Comment";
  declare readonly value: string;
  declare readonly span?: SourceSpan;

  constructor(fields: CommentFields) {
    this.value = fields.value;
    if (fields.span !== undefined) this.span = fields.span;
  }
}

/** Codec for validated Comment nodes and their plain representation. */
export const CommentSchema = nodeCodec(CommentEncoded, Comment, "effect-xml/XmlNode/Comment");

/** Refines a value through Comment class identity. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public predicate checks ordinary node class identity.
export const isComment = (input: unknown): input is Comment => input instanceof Comment;
