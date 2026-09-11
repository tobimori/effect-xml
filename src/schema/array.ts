import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { Element, isElement } from "../ast/element.ts";
import { encoded, getPlacement, type ArrayItem } from "./metadata.ts";

/** Repeats an element codec while retaining encounter order. */
export const Array = <S extends ArrayItem>(
  item: S,
): Schema.Codec<
  ReadonlyArray<S["Type"]>,
  ReadonlyArray<Element>,
  S["DecodingServices"],
  S["EncodingServices"]
> => {
  const placement = getPlacement(item);
  if (placement?.kind !== "element") {
    throw new Error("Xml.Array requires an XML element codec with retained placement");
  }

  const raw = encoded(
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the Schema.declare array parsing boundary.
    (input): input is ReadonlyArray<Element> =>
      globalThis.Array.isArray(input) && input.every(isElement),
    { kind: "array", item: placement },
  );

  return raw.pipe(
    Schema.decodeTo(
      Schema.Array(item),
      SchemaTransformation.transform({
        decode: (elements) => elements,
        encode: (elements) => elements,
      }),
    ),
  );
};
