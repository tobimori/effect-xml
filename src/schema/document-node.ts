import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { Document as AstDocument, DocumentSchema as AstDocumentSchema } from "../ast/document.ts";
import { parseDocument, type ParseOptions } from "../parser/parser.ts";
import { serializeDocument } from "../serializer/serializer.ts";
import {
  CurrentDecodeState,
  CurrentEncodeState,
  initializeXmlNamespaceScopes,
  withXmlDecodeState,
  xmlSerializerOptions,
} from "./context.ts";
import { delegateRequired } from "./delegate.ts";
import { encodedString } from "./metadata.ts";

export interface DocumentNodeOptions extends ParseOptions {
  readonly pretty?: boolean;
  readonly indent?: string;
}

const makeDocumentNode = (
  options: DocumentNodeOptions,
  shareCurrentState: boolean,
): Schema.Codec<AstDocument, string> => {
  const source = encodedString({ kind: "document" });
  const codec = source.pipe(
    Schema.decodeTo(
      Schema.toType(AstDocumentSchema),
      SchemaTransformation.transformEffect({
        decode: (source) =>
          Effect.flatMap(CurrentDecodeState, (state) => {
            const parsed = parseDocument(source, options);
            if (Result.isFailure(parsed)) return Effect.fail(parsed.failure);
            if (state !== undefined) {
              state.positions = parsed.success.positions;
              state.root = parsed.success.document.root;
              state.sourceRoot = parsed.success.document.root;
              initializeXmlNamespaceScopes(state);
            }
            return Effect.succeed(parsed.success.document);
          }),
        encode: (document) =>
          Effect.flatMap(CurrentEncodeState, (state) => {
            const serialized = serializeDocument(
              document,
              xmlSerializerOptions(options, state, shareCurrentState),
            );
            return Result.isFailure(serialized)
              ? Effect.fail(serialized.failure)
              : Effect.succeed(serialized.success);
          }),
      }),
    ),
  );

  return delegateRequired(
    codec,
    (effect) => withXmlDecodeState(effect, !shareCurrentState),
    (effect) => effect,
  );
};

/** A low-level string codec for complete XML document AST values. */
export const DocumentNode = (
  options: DocumentNodeOptions = {},
): Schema.Codec<AstDocument, string> => makeDocumentNode(options, false);

/** Builds the private raw-document stage inside an already isolated typed Document. */
export const documentNodeWithinDocument = (options: DocumentNodeOptions) =>
  makeDocumentNode(options, true);
