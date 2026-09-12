import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";

import { isChild } from "../ast/element.ts";
import { encoded, getPlacement, isSingleChildPlacement, type ArrayItem } from "./metadata.ts";
import { orderedCollection } from "./ordered-content.ts";
import { guardDescent, guardProduct } from "./path-guard.ts";

type ArrayItemInput<S extends ArrayItem> = S["~encoded.optionality"] extends "optional" ? never : S;

/** Repeats one XML child codec while retaining encounter order. */
export const Array = <S extends ArrayItem>(
  item: ArrayItemInput<S>,
): Schema.Codec<
  ReadonlyArray<S["Type"]>,
  ReadonlyArray<S["Encoded"]>,
  S["DecodingServices"],
  S["EncodingServices"]
> => {
  if (SchemaAST.isOptional(SchemaAST.toEncoded(item.ast))) {
    throw new Error("Xml.Array items cannot use encoded optional-key placement");
  }
  const placement = getPlacement(item);
  if (placement === undefined || !isSingleChildPlacement(placement)) {
    throw new Error("Xml.Array requires a single XML child codec with retained placement");
  }
  const raw = encoded(
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the ordered child-array boundary.
    (input): input is ReadonlyArray<S["Encoded"]> =>
      globalThis.Array.isArray(input) && input.every(isChild),
    { kind: "array", item: placement },
  );
  return orderedCollection(raw, guardProduct(Schema.Array(guardDescent(item))));
};
