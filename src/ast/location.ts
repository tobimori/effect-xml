import * as Schema from "effect/Schema";

/** A half-open range of UTF-16 offsets in the original XML source. */
export const SourceSpan = Schema.Struct({
  start: Schema.Natural,
  end: Schema.Natural,
}).check(
  Schema.makeFilter(
    (span) =>
      span.end >= span.start ? undefined : { path: ["end"], issue: "end must not precede start" },
    { identifier: "effect-xml/XmlNode/SourceSpan" },
  ),
);

/** The decoded source-span value. */
export type SourceSpan = Schema.Schema.Type<typeof SourceSpan>;

/** Refines a value to a validated SourceSpan. */
export const isSourceSpan = Schema.is(SourceSpan);
