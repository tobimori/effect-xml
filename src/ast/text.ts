import * as Schema from "effect/Schema";

import { SourceSpan } from "./location.ts";

/** Ordinary XML character data. */
export class Text extends Schema.TaggedClass<Text>("effect-xml/XmlNode/Text")("Text", {
  value: Schema.String,
  span: Schema.optionalKey(SourceSpan),
}) {}

/** Character data originating from a CDATA section. */
export class CData extends Schema.TaggedClass<CData>("effect-xml/XmlNode/CData")("CData", {
  value: Schema.String,
  span: Schema.optionalKey(SourceSpan),
}) {}

/** Refines a value through Effect's Text class recognition. */
export const isText = Schema.is(Text);

/** Refines a value through Effect's CData class recognition. */
export const isCData = Schema.is(CData);
