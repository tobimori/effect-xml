import * as Schema from "effect/Schema";

import { SourceSpan } from "./location.ts";
import { nodeCodec } from "./node-codec.ts";

const DeclarationEncoded = Schema.TaggedStruct("Declaration", {
  version: Schema.Literals(["1.0", "1.1"]),
  encoding: Schema.optionalKey(Schema.String),
  standalone: Schema.optionalKey(Schema.Literals(["yes", "no"])),
  span: Schema.optionalKey(SourceSpan),
});

type DeclarationFields = Omit<Schema.Schema.Type<typeof DeclarationEncoded>, "_tag">;

/** An XML declaration. Constructors store fields without validating them. */
export class Declaration {
  readonly _tag = "Declaration";
  declare readonly version: "1.0" | "1.1";
  declare readonly encoding?: string;
  declare readonly standalone?: "yes" | "no";
  declare readonly span?: SourceSpan;

  constructor(fields: DeclarationFields) {
    this.version = fields.version;
    if (fields.encoding !== undefined) this.encoding = fields.encoding;
    if (fields.standalone !== undefined) this.standalone = fields.standalone;
    if (fields.span !== undefined) this.span = fields.span;
  }
}

/** Codec for validated Declaration nodes and their plain representation. */
export const DeclarationSchema = nodeCodec(
  DeclarationEncoded,
  Declaration,
  "effect-xml/XmlNode/Declaration",
);

/** Refines a value through Declaration class identity. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public predicate checks ordinary node class identity.
export const isDeclaration = (input: unknown): input is Declaration => input instanceof Declaration;
