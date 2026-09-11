import * as Schema from "effect/Schema";

import { SourceSpan } from "./location.ts";
import { Name } from "./name.ts";

/** A namespace-resolved XML attribute. */
export class Attribute extends Schema.TaggedClass<Attribute>("effect-xml/XmlNode/Attribute")(
  "Attribute",
  {
    name: Name,
    value: Schema.String,
    span: Schema.optionalKey(SourceSpan),
  },
) {}

/** Refines a value through Effect's Attribute class recognition. */
export const isAttribute = Schema.is(Attribute);
