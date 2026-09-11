import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { CData as CDataNode, isCData } from "../ast/text.ts";
import { encoded } from "./metadata.ts";
import { scalar, validateXmlCharacters } from "./scalar.ts";

/** Places one scalar value in one XML CDATA node. */
export const CData = <S extends Schema.Constraint>(
  schema: S,
): Schema.Codec<S["Type"], CDataNode, S["DecodingServices"], S["EncodingServices"]> =>
  encoded(
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the CDATA-node boundary.
    (input): input is CDataNode => isCData(input),
    { kind: "cdata" },
  ).pipe(
    Schema.decodeTo(
      scalar(schema),
      SchemaTransformation.transformEffect<string, CDataNode>({
        decode: (cdata) => Effect.succeed(cdata.value),
        encode: (value, options) =>
          Effect.map(
            validateXmlCharacters(value, "XML CDATA", options),
            (valid) => new CDataNode({ value: valid }),
          ),
      }),
    ),
  );
