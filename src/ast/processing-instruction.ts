import * as Schema from "effect/Schema";

import { SourceSpan } from "./location.ts";

/** An XML processing instruction. */
export class ProcessingInstruction extends Schema.TaggedClass<ProcessingInstruction>(
  "effect-xml/XmlNode/ProcessingInstruction",
)("ProcessingInstruction", {
  target: Schema.String,
  value: Schema.String,
  span: Schema.optionalKey(SourceSpan),
}) {}

/** Refines a value through Effect's ProcessingInstruction class recognition. */
export const isProcessingInstruction = Schema.is(ProcessingInstruction);
