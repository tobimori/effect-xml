import * as Schema from "effect/Schema";

import { isChild } from "../ast/element.ts";
import {
  encoded,
  getPlacement,
  isSingleChildPlacement,
  type SingleChildPlacement,
  type TupleItem,
} from "./metadata.ts";
import { orderedCollection } from "./ordered-content.ts";
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
      globalThis.Array.isArray(input) && input.every(isChild),
    { kind: "tuple", items: placements },
  );
  return orderedCollection(raw, target);
};
