import * as Schema from "effect/Schema";

import { ChildNode, type Child } from "./element.ts";
import { SourceSpan } from "./location.ts";
import { nodeCodec } from "./node-codec.ts";

const FragmentEncoded = Schema.TaggedStruct("Fragment", {
  children: Schema.Array(ChildNode),
  span: Schema.optionalKey(SourceSpan),
});

type FragmentFields = Omit<Schema.Schema.Type<typeof FragmentEncoded>, "_tag">;

/** An ordered XML content sequence without a declaration or document root. */
export class Fragment {
  readonly _tag = "Fragment";
  declare readonly children: ReadonlyArray<Child>;
  declare readonly span?: SourceSpan;

  constructor(fields: FragmentFields) {
    this.children = fields.children;
    if (fields.span !== undefined) this.span = fields.span;
  }
}

/** Codec for validated Fragment nodes and their plain representation. */
export const FragmentSchema: Schema.Codec<
  Fragment,
  Schema.Codec.Encoded<typeof FragmentEncoded>
> = nodeCodec(FragmentEncoded, Fragment, "effect-xml/XmlNode/Fragment");

/** Refines a value through Fragment class identity. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public predicate checks ordinary node class identity.
export const isFragment = (input: unknown): input is Fragment => input instanceof Fragment;
