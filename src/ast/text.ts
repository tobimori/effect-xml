import * as Schema from "effect/Schema";

import { SourceSpan } from "./location.ts";
import { nodeCodec } from "./node-codec.ts";

const TextEncoded = Schema.TaggedStruct("Text", {
  value: Schema.String,
  span: Schema.optionalKey(SourceSpan),
});

type TextFields = Omit<Schema.Schema.Type<typeof TextEncoded>, "_tag">;

/** Ordinary XML character data. Constructors store fields without validating them. */
export class Text {
  readonly _tag = "Text";
  declare readonly value: string;
  declare readonly span?: SourceSpan;

  constructor(fields: TextFields) {
    this.value = fields.value;
    if (fields.span !== undefined) this.span = fields.span;
  }
}

/** Codec for validated Text nodes and their plain representation. */
export const TextSchema = nodeCodec(TextEncoded, Text, "effect-xml/XmlNode/Text");

const CDataEncoded = Schema.TaggedStruct("CData", {
  value: Schema.String,
  span: Schema.optionalKey(SourceSpan),
});

type CDataFields = Omit<Schema.Schema.Type<typeof CDataEncoded>, "_tag">;

/** Character data originating from a CDATA section. Constructors do not validate fields. */
export class CData {
  readonly _tag = "CData";
  declare readonly value: string;
  declare readonly span?: SourceSpan;

  constructor(fields: CDataFields) {
    this.value = fields.value;
    if (fields.span !== undefined) this.span = fields.span;
  }
}

/** Codec for validated CData nodes and their plain representation. */
export const CDataSchema = nodeCodec(CDataEncoded, CData, "effect-xml/XmlNode/CData");

/** Refines a value through Text class identity. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public predicate checks ordinary node class identity.
export const isText = (input: unknown): input is Text => input instanceof Text;

/** Refines a value through CData class identity. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public predicate checks ordinary node class identity.
export const isCData = (input: unknown): input is CData => input instanceof CData;
