import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { Declaration } from "../ast/declaration.ts";
import { Document as AstDocument } from "../ast/document.ts";
import { isElement } from "../ast/element.ts";
import { CurrentEncodeState } from "./context.ts";
import {
  documentNodeWithinDocument,
  type DocumentNodeOptions,
  withDocumentDecodeState,
} from "./document-node.ts";
import type { DocumentRoot } from "./metadata.ts";

export interface DeclarationOptions {
  readonly version: "1.0" | "1.1";
  readonly encoding?: string;
  readonly standalone?: "yes" | "no";
}

export interface DocumentOptions extends DocumentNodeOptions {
  readonly sortKeys?: boolean;
  readonly declaration?: DeclarationOptions;
}

/** Maps one typed root element to a complete XML document string. */
// RETURN TYPE: Preserves both service sets while fixing the public encoded side to string.
export const Document = <S extends DocumentRoot>(
  root: S,
  options: DocumentOptions = {},
): Schema.Codec<S["Type"], string, S["DecodingServices"], S["EncodingServices"]> => {
  const codec = documentNodeWithinDocument(options).pipe(
    Schema.decodeTo(
      root,
      SchemaTransformation.transformEffect({
        decode: (document) => Effect.succeed(document.root),
        encode: (element, parseOptions) => {
          if (!isElement(element)) {
            return Effect.fail(
              new SchemaIssue.InvalidValue(
                { message: "Expected one encoded XML document root element" },
                element,
                parseOptions,
              ),
            );
          }
          const fields = { prolog: [], root: element, epilog: [] };
          return Effect.succeed(
            options.declaration === undefined
              ? new AstDocument(fields)
              : new AstDocument({
                  ...fields,
                  declaration: new Declaration(options.declaration),
                }),
          );
        },
      }),
    ),
  );

  return codec.pipe(
    Schema.middlewareDecoding((effect) => withDocumentDecodeState(effect, true)),
    Schema.middlewareEncoding((effect) =>
      Effect.suspend(() =>
        Effect.provideService(effect, CurrentEncodeState, {
          structured: new WeakSet(),
          sortKeys: options.sortKeys !== false,
        }),
      ),
    ),
  );
};
