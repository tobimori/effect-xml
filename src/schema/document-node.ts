import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import type * as SchemaIssue from "effect/SchemaIssue";

import { Document as AstDocument } from "../ast/document.ts";
import { isElement, type Element } from "../ast/element.ts";
import { parseDocument, type ParseOptions } from "../parser/parser.ts";
import { serializeDocument, type SerializeOptions } from "../serializer/serializer.ts";
import { CurrentDecodeState, CurrentEncodeState, type DecodeState } from "./context.ts";
import { encodedString } from "./metadata.ts";
import { associateSource, type XmlLocation } from "./provenance.ts";

export interface DocumentNodeOptions extends ParseOptions {
  readonly pretty?: boolean;
  readonly indent?: string;
}

// RETURN TYPE: Narrows the provenance cursor's readonly-array union member.
const isElementArray = (
  value: Element | Element["attributes"][number] | ReadonlyArray<Element>,
): value is ReadonlyArray<Element> => globalThis.Array.isArray(value);

// RETURN TYPE: Source lookup explicitly models paths without a corresponding parsed node.
const locationAt = (
  state: DecodeState,
  path: ReadonlyArray<PropertyKey>,
): XmlLocation | undefined => {
  let current: Element | Element["attributes"][number] | ReadonlyArray<Element> | undefined =
    state.root;

  for (const key of path) {
    if (current === undefined) break;
    if (isElementArray(current)) {
      current = Predicate.isNumber(key) ? current[key] : undefined;
      continue;
    }
    if (!isElement(current)) break;
    const next: import("./context.ts").ProjectedNode | undefined = state.projections
      .get(current)
      ?.get(key);
    if (next === undefined) break;
    current = next;
  }

  if (current === undefined || isElementArray(current)) {
    return state.root === undefined ? undefined : state.positions.get(state.root);
  }
  return (
    state.positions.get(current) ??
    (state.root === undefined ? undefined : state.positions.get(state.root))
  );
};

export const withDocumentDecodeState = <A, R>(
  effect: Effect.Effect<A, SchemaIssue.Issue, R>,
  isolated = false,
) =>
  Effect.flatMap(CurrentDecodeState, (current) => {
    if (!isolated && current !== undefined) return effect;
    const state: DecodeState = {
      positions: new WeakMap(),
      projections: new WeakMap(),
      preservesSpace: new WeakMap(),
    };
    return Effect.provideService(
      Effect.mapError(effect, (issue) =>
        associateSource(issue, {
          location: (path) => locationAt(state, path),
        }),
      ),
      CurrentDecodeState,
      state,
    );
  });

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
            }
            return Effect.succeed(parsed.success.document);
          }),
        encode: (document) =>
          Effect.flatMap(CurrentEncodeState, (state) => {
            let serializerOptions: SerializeOptions = shareCurrentState
              ? {
                  structured: state?.structured ?? new WeakSet(),
                  typed: state?.typed ?? new WeakSet(),
                }
              : {};
            if (options.pretty !== undefined) {
              serializerOptions = { ...serializerOptions, pretty: options.pretty };
            }
            if (options.indent !== undefined) {
              serializerOptions = { ...serializerOptions, indent: options.indent };
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
