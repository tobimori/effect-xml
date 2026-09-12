import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

/** Connects a validated plain node representation to its ordinary storage class. */
export const nodeCodec = <Encoded extends Schema.Constraint, Node extends Encoded["Type"]>(
  encoded: Encoded,
  constructor: new (fields: Encoded["Type"]) => Node,
  identifier: string,
): Schema.Codec<
  Node,
  Encoded["Encoded"],
  Encoded["DecodingServices"],
  Encoded["EncodingServices"]
> =>
  Schema.decodeTo(
    Schema.instanceOf(constructor, { identifier }),
    SchemaTransformation.transform<Node, Encoded["Type"]>({
      decode: (fields) => new constructor(fields),
      encode: (node) => node,
    }),
  )(encoded);
