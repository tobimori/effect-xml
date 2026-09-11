import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { CurrentDecodeState } from "./context.ts";
import {
  encoded,
  getPlacement,
  isSingleChildPlacement,
  type SingleChildPlacement,
  type TupleItem,
} from "./metadata.ts";
import {
  canonicalizeOrderedChildren,
  isOrderedChild,
  validateOrderedChildren,
} from "./ordered-content.ts";
import { guardDescent, guardProduct } from "./path-guard.ts";

type TupleItems = ReadonlyArray<TupleItem>;

/** Maps a fixed sequence of XML child codecs in declaration order. */
export const Tuple = <const Items extends TupleItems>(
  items: Items,
): Schema.Codec<
  Schema.Tuple.Type<Items>,
  Schema.Tuple.Encoded<Items>,
  Schema.Tuple.DecodingServices<Items>,
  Schema.Tuple.EncodingServices<Items>
> => {
  const placements: Array<SingleChildPlacement> = [];
  for (const item of items) {
    const placement = getPlacement(item);
    if (placement === undefined || !isSingleChildPlacement(placement)) {
      throw new Error("Xml.Tuple requires single XML child codecs with retained placement");
    }
    placements.push(placement);
  }
  const guardedItems = items.map(guardDescent) as {
    readonly [Key in keyof Items]: ReturnType<typeof guardDescent<Items[Key]>>;
  };
  const target = guardProduct(Schema.Tuple(guardedItems)) as Schema.Codec<
    Schema.Tuple.Type<Items>,
    Schema.Tuple.Encoded<Items>,
    Schema.Tuple.DecodingServices<Items>,
    Schema.Tuple.EncodingServices<Items>
  >;
  const raw = encoded(
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the ordered tuple boundary.
    (input): input is Schema.Tuple.Encoded<Items> =>
      globalThis.Array.isArray(input) && input.every(isOrderedChild),
    { kind: "tuple", items: placements },
  );
  return raw.pipe(
    Schema.decodeTo(
      target,
      SchemaTransformation.transformEffect<
        Schema.Tuple.Encoded<Items>,
        Schema.Tuple.Encoded<Items>
      >({
        decode: (children) =>
          Effect.map(CurrentDecodeState, (state) => {
            return canonicalizeOrderedChildren(children, state) as Schema.Tuple.Encoded<Items>;
          }),
        encode: (children, options) =>
          Effect.map(validateOrderedChildren(children, raw.ast, options), (valid) => {
            return valid as Schema.Tuple.Encoded<Items>;
          }),
      }),
    ),
  );
};
