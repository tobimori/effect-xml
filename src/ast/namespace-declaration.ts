import * as Schema from "effect/Schema";

import { SourceSpan } from "./location.ts";
import { nodeCodec } from "./node-codec.ts";

const NamespaceDeclarationEncoded = Schema.TaggedStruct("NamespaceDeclaration", {
  prefix: Schema.optionalKey(Schema.String),
  namespaceUri: Schema.String,
  span: Schema.optionalKey(SourceSpan),
});

type NamespaceDeclarationFields = Omit<
  Schema.Schema.Type<typeof NamespaceDeclarationEncoded>,
  "_tag"
>;

/** A namespace binding declared on an element. Constructors do not validate fields. */
export class NamespaceDeclaration {
  readonly _tag = "NamespaceDeclaration";
  declare readonly prefix?: string;
  declare readonly namespaceUri: string;
  declare readonly span?: SourceSpan;

  constructor(fields: NamespaceDeclarationFields) {
    if (fields.prefix !== undefined) this.prefix = fields.prefix;
    this.namespaceUri = fields.namespaceUri;
    if (fields.span !== undefined) this.span = fields.span;
  }
}

/** Codec for validated NamespaceDeclaration nodes and their plain representation. */
export const NamespaceDeclarationSchema = nodeCodec(
  NamespaceDeclarationEncoded,
  NamespaceDeclaration,
  "effect-xml/XmlNode/NamespaceDeclaration",
);

/** Refines a value through NamespaceDeclaration class identity. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public predicate checks ordinary node class identity.
export const isNamespaceDeclaration = (input: unknown): input is NamespaceDeclaration =>
  input instanceof NamespaceDeclaration;
