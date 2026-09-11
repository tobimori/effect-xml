import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { Fragment as AstFragment } from "../ast/fragment.ts";
import { parseFragment, type FragmentParseOptions } from "../parser/parser.ts";
import { serializeFragment, type FragmentSerializeOptions } from "../serializer/serializer.ts";
import { CurrentDecodeState, CurrentEncodeState, withXmlDecodeState } from "./context.ts";

export interface FragmentNodeOptions extends FragmentParseOptions {
  readonly pretty?: boolean;
  readonly indent?: string;
}

// RETURN TYPE: Narrows the raw and typed stages to the same public string boundary.
const makeFragmentNode = (
  options: FragmentNodeOptions,
  shareCurrentState: boolean,
): Schema.Codec<AstFragment, string> => {
  const codec = Schema.String.pipe(
    Schema.decodeTo(
      Schema.toType(AstFragment),
      SchemaTransformation.transformEffect({
        decode: (source) =>
          Effect.flatMap(CurrentDecodeState, (state) => {
            const parsed = parseFragment(source, options);
            if (Result.isFailure(parsed)) return Effect.fail(parsed.failure);
            if (state !== undefined) {
              state.positions = parsed.success.positions;
              state.root = parsed.success.fragment;
              state.sourceRoot = parsed.success.fragment;
            }
            return Effect.succeed(parsed.success.fragment);
          }),
        encode: (fragment) =>
          Effect.flatMap(CurrentEncodeState, (state) => {
            let serializerOptions: FragmentSerializeOptions = options;
            if (shareCurrentState && Predicate.isObject(options)) {
              serializerOptions = {
                ...options,
                structured: state?.structured ?? new WeakSet(),
                typed: state?.typed ?? new WeakSet(),
              };
            }
            const serialized = serializeFragment(fragment, serializerOptions);
            return Result.isFailure(serialized)
              ? Effect.fail(serialized.failure)
              : Effect.succeed(serialized.success);
          }),
      }),
    ),
  );

  return codec.pipe(
    Schema.middlewareDecoding((effect) => withXmlDecodeState(effect, !shareCurrentState)),
  );
};

/** A low-level string codec for declaration-free XML fragment AST values. */
// RETURN TYPE: Exposes the low-level codec's public Fragment/string boundary.
export const FragmentNode = (
  options: FragmentNodeOptions = {},
): Schema.Codec<AstFragment, string> => makeFragmentNode(options, false);

/** Builds the private raw-fragment stage inside one isolated typed Fragment. */
export const fragmentNodeWithinFragment = (options: FragmentNodeOptions) =>
  makeFragmentNode(options, true);
