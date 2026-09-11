import * as Schema from "effect/Schema";

import { ChildNode } from "./element.ts";
import { SourceSpan } from "./location.ts";

/** An ordered XML content sequence without a declaration or document root. */
export class Fragment extends Schema.TaggedClass<Fragment>("effect-xml/XmlNode/Fragment")(
  "Fragment",
  {
    children: Schema.Array(ChildNode),
    span: Schema.optionalKey(SourceSpan),
  },
) {}

/** Refines a value through Effect's Fragment class recognition. */
export const isFragment = Schema.is(Fragment);
