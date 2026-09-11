import * as Schema from "effect/Schema";

import { SourceSpan } from "./location.ts";

/** An XML expanded name with an optional serialization prefix. */
export class Name extends Schema.TaggedClass<Name>("effect-xml/XmlNode/Name")("Name", {
  localName: Schema.String,
  namespaceUri: Schema.optionalKey(Schema.String),
  prefix: Schema.optionalKey(Schema.String),
  span: Schema.optionalKey(SourceSpan),
}) {
  get qualifiedName() {
    return this.prefix === undefined ? this.localName : `${this.prefix}:${this.localName}`;
  }
}

/** Refines a value through Effect's Name class recognition. */
export const isName = Schema.is(Name);
