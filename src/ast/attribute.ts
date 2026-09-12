import * as Schema from "effect/Schema";

import { SourceSpan } from "./location.ts";
import { Name, NameSchema } from "./name.ts";
import { nodeCodec } from "./node-codec.ts";

const AttributeEncoded = Schema.TaggedStruct("Attribute", {
  name: NameSchema,
  value: Schema.String,
  span: Schema.optionalKey(SourceSpan),
});

type AttributeFields = Omit<Schema.Schema.Type<typeof AttributeEncoded>, "_tag">;

/** A namespace-resolved XML attribute. Constructors store fields without validating them. */
export class Attribute {
  readonly _tag = "Attribute";
  declare readonly name: Name;
  declare readonly value: string;
  declare readonly span?: SourceSpan;

  constructor(fields: AttributeFields) {
    this.name = fields.name;
    this.value = fields.value;
    if (fields.span !== undefined) this.span = fields.span;
  }
}

/** Codec for validated Attribute nodes and their plain representation. */
export const AttributeSchema = nodeCodec(
  AttributeEncoded,
  Attribute,
  "effect-xml/XmlNode/Attribute",
);

/** Refines a value through Attribute class identity. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public predicate checks ordinary node class identity.
export const isAttribute = (input: unknown): input is Attribute => input instanceof Attribute;
