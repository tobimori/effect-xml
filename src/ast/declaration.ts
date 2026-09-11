import * as Schema from "effect/Schema";

import { SourceSpan } from "./location.ts";

/** An XML declaration. */
export class Declaration extends Schema.TaggedClass<Declaration>("effect-xml/XmlNode/Declaration")(
  "Declaration",
  {
    version: Schema.Literals(["1.0", "1.1"]),
    encoding: Schema.optionalKey(Schema.String),
    standalone: Schema.optionalKey(Schema.Literals(["yes", "no"])),
    span: Schema.optionalKey(SourceSpan),
  },
) {}

/** Refines a value through Effect's Declaration class recognition. */
export const isDeclaration = Schema.is(Declaration);
