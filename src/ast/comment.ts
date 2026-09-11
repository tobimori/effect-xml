import * as Schema from "effect/Schema";

import { SourceSpan } from "./location.ts";

/** An XML comment. Grammar validation belongs to parsing and serialization. */
export class Comment extends Schema.TaggedClass<Comment>("effect-xml/XmlNode/Comment")("Comment", {
  value: Schema.String,
  span: Schema.optionalKey(SourceSpan),
}) {}

/** Refines a value through Effect's Comment class recognition. */
export const isComment = Schema.is(Comment);
