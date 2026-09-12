import * as Schema from "effect/Schema";

import { SourceSpan } from "./location.ts";
import { nodeCodec } from "./node-codec.ts";

const ProcessingInstructionEncoded = Schema.TaggedStruct("ProcessingInstruction", {
  target: Schema.String,
  value: Schema.String,
  span: Schema.optionalKey(SourceSpan),
});

type ProcessingInstructionFields = Omit<
  Schema.Schema.Type<typeof ProcessingInstructionEncoded>,
  "_tag"
>;

/** An XML processing instruction. Constructors store fields without validating them. */
export class ProcessingInstruction {
  readonly _tag = "ProcessingInstruction";
  declare readonly target: string;
  declare readonly value: string;
  declare readonly span?: SourceSpan;

  constructor(fields: ProcessingInstructionFields) {
    this.target = fields.target;
    this.value = fields.value;
    if (fields.span !== undefined) this.span = fields.span;
  }
}

/** Codec for validated ProcessingInstruction nodes and their plain representation. */
export const ProcessingInstructionSchema = nodeCodec(
  ProcessingInstructionEncoded,
  ProcessingInstruction,
  "effect-xml/XmlNode/ProcessingInstruction",
);

/** Refines a value through ProcessingInstruction class identity. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public predicate checks ordinary node class identity.
export const isProcessingInstruction = (input: unknown): input is ProcessingInstruction =>
  input instanceof ProcessingInstruction;
