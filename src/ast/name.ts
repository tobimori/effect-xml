import * as Schema from "effect/Schema";

import { SourceSpan } from "./location.ts";
import { nodeCodec } from "./node-codec.ts";

const NameEncoded = Schema.TaggedStruct("Name", {
  localName: Schema.String,
  namespaceUri: Schema.optionalKey(Schema.String),
  prefix: Schema.optionalKey(Schema.String),
  span: Schema.optionalKey(SourceSpan),
});

type NameFields = Omit<Schema.Schema.Type<typeof NameEncoded>, "_tag">;

/** An XML expanded name with an optional serialization prefix. */
export class Name {
  readonly _tag = "Name";
  declare readonly localName: string;
  declare readonly namespaceUri?: string;
  declare readonly prefix?: string;
  declare readonly span?: SourceSpan;

  constructor(fields: NameFields) {
    this.localName = fields.localName;
    if (fields.namespaceUri !== undefined) this.namespaceUri = fields.namespaceUri;
    if (fields.prefix !== undefined) this.prefix = fields.prefix;
    if (fields.span !== undefined) this.span = fields.span;
  }

  get qualifiedName() {
    return this.prefix === undefined ? this.localName : `${this.prefix}:${this.localName}`;
  }
}

/** Codec for validated Name nodes and their plain representation. */
export const NameSchema = nodeCodec(NameEncoded, Name, "effect-xml/XmlNode/Name");

/** Refines a value through Name class identity. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public predicate checks ordinary node class identity.
export const isName = (input: unknown): input is Name => input instanceof Name;
