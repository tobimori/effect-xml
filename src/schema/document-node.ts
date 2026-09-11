import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { Document as AstDocument } from "../ast/document.ts";
import { parseDocument, type ParseOptions } from "../parser/parser.ts";
import { serializeDocument, type SerializeOptions } from "../serializer/serializer.ts";
import { CurrentDecodeState, CurrentEncodeState, withXmlDecodeState } from "./context.ts";
import { encodedString } from "./metadata.ts";

export interface DocumentNodeOptions extends ParseOptions {
  readonly pretty?: boolean;
  readonly indent?: string;
}

export const withDocumentDecodeState = withXmlDecodeState;

// RETURN TYPE: Keeps the private state-sharing variant at the same public string boundary.
const makeDocumentNode = (
  options: DocumentNodeOptions,
  shareCurrentState: boolean,
): Schema.Codec<AstDocument, string> => {
  const source = encodedString({ kind: "document" });
  const codec = source.pipe(
    Schema.decodeTo(
      Schema.toType(AstDocument),
      SchemaTransformation.transformEffect({
        decode: (source) =>
          Effect.flatMap(CurrentDecodeState, (state) => {
            const parsed = parseDocument(source, options);
            if (Result.isFailure(parsed)) return Effect.fail(parsed.failure);
            if (state !== undefined) {
              state.positions = parsed.success.positions;
              state.root = parsed.success.document.root;
              state.sourceRoot = parsed.success.document.root;
            }
            return Effect.succeed(parsed.success.document);
          }),
        encode: (document) =>
          Effect.flatMap(CurrentEncodeState, (state) => {
            let serializerOptions: SerializeOptions = options;
            if (shareCurrentState && Predicate.isObject(options)) {
              serializerOptions = {
                ...options,
                structured: state?.structured ?? new WeakSet(),
                typed: state?.typed ?? new WeakSet(),
              };
            }
            const serialized = serializeDocument(document, serializerOptions);
            return Result.isFailure(serialized)
              ? Effect.fail(serialized.failure)
              : Effect.succeed(serialized.success);
          }),
      }),
    ),
  );

  return codec.pipe(
    Schema.middlewareDecoding((effect) => withDocumentDecodeState(effect, !shareCurrentState)),
  );
};

/** A low-level string codec for complete XML document AST values. */
// RETURN TYPE: Exposes the low-level codec's public Document/string boundary.
export const DocumentNode = (
  options: DocumentNodeOptions = {},
): Schema.Codec<AstDocument, string> => makeDocumentNode(options, false);

/** Builds the private raw-document stage inside an already isolated typed Document. */
export const documentNodeWithinDocument = (options: DocumentNodeOptions) =>
  makeDocumentNode(options, true);
