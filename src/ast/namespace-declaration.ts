import * as Schema from "effect/Schema";

import { SourceSpan } from "./location.ts";

/** A namespace binding declared on an element. */
export class NamespaceDeclaration extends Schema.TaggedClass<NamespaceDeclaration>(
  "effect-xml/XmlNode/NamespaceDeclaration",
)("NamespaceDeclaration", {
  prefix: Schema.optionalKey(Schema.String),
  namespaceUri: Schema.String,
  span: Schema.optionalKey(SourceSpan),
}) {}

/** Refines a value through Effect's NamespaceDeclaration class recognition. */
export const isNamespaceDeclaration = Schema.is(NamespaceDeclaration);
