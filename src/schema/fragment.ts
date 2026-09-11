import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { isChild, type Child } from "../ast/element.ts";
import { Fragment as AstFragment } from "../ast/fragment.ts";
import { NamespaceContext } from "../namespace/context.ts";
import { CurrentDecodeState, CurrentEncodeState, withXmlDecodeState } from "./context.ts";
import { delegateRequired } from "./delegate.ts";
import { fragmentNodeWithinFragment, type FragmentNodeOptions } from "./fragment-node.ts";
import {
  acceptsEncodedUndefined,
  getPlacement,
  isSingleChildPlacement,
  type FragmentContent,
} from "./metadata.ts";
import { canonicalizeOrderedChildren, validateOrderedChildren } from "./ordered-content.ts";

export interface FragmentOptions extends FragmentNodeOptions {
  readonly sortKeys?: boolean;
}

const invalid = <Input>(message: string, input: Input, options: SchemaAST.ParseOptions) =>
  new SchemaIssue.InvalidValue({ message }, input, options);

const validateOptions = (
  fragmentOptions: FragmentOptions,
  parseOptions: SchemaAST.ParseOptions,
) => {
  const input: unknown = fragmentOptions;
  if (!Predicate.isObject(input)) {
    return Effect.fail(invalid("XML fragment options must be an object", input, parseOptions));
  }
  const version = Predicate.hasProperty(input, "version") ? input.version : undefined;
  if (version !== undefined && version !== "1.0" && version !== "1.1") {
    return Effect.fail(
      invalid('XML fragment version must be "1.0" or "1.1"', version, parseOptions),
    );
  }
  const namespaces = Predicate.hasProperty(input, "namespaces") ? input.namespaces : undefined;
  const sortKeys = Predicate.hasProperty(input, "sortKeys") ? input.sortKeys : undefined;
  if (sortKeys !== undefined && !Predicate.isBoolean(sortKeys)) {
    return Effect.fail(
      invalid("XML fragment option sortKeys must be a boolean", sortKeys, parseOptions),
    );
  }
  const selectedVersion: "1.0" | "1.1" = version ?? "1.0";
  if (namespaces === undefined) return Effect.succeed(selectedVersion);
  return Effect.map(
    Effect.mapError(
      Schema.encodeUnknownEffect(NamespaceContext)(namespaces),
      (error) => error.issue,
    ),
    () => selectedVersion,
  );
};

/** Maps one typed XML child or child sequence to declaration-free XML text. */
export const Fragment = <S extends FragmentContent>(
  content: S,
  options: FragmentOptions = {},
): Schema.Codec<S["Type"], string, S["DecodingServices"], S["EncodingServices"]> => {
  const placement = getPlacement(content);
  if (
    placement === undefined ||
    (placement.kind !== "array" && placement.kind !== "tuple" && !isSingleChildPlacement(placement))
  ) {
    throw new Error("Xml.Fragment requires an XML child or child-sequence codec");
  }
  const optional = acceptsEncodedUndefined(content);

  const codec = fragmentNodeWithinFragment(options).pipe(
    Schema.decodeTo(
      content,
      SchemaTransformation.transformEffect({
        decode: (fragment, parseOptions) =>
          Effect.flatMap(CurrentDecodeState, (state) => {
            const children = canonicalizeOrderedChildren(fragment.children, state);
            if (placement.kind === "array" || placement.kind === "tuple") {
              if (state !== undefined) state.root = children;
              return Effect.succeed(children as S["Encoded"]);
            }
            if (children.length === 0 && optional) {
              if (state !== undefined) state.root = fragment;
              return Effect.succeed(undefined as S["Encoded"]);
            }
            if (children.length !== 1) {
              if (state !== undefined) state.root = fragment;
              return Effect.fail(
                invalid("Expected exactly one XML fragment child", children, parseOptions),
              );
            }
            const child = children[0]!;
            if (state !== undefined) state.root = child;
            return Effect.succeed(child as S["Encoded"]);
          }),
        encode: (encoded, parseOptions) => {
          if (placement.kind === "array" || placement.kind === "tuple") {
            if (encoded === undefined && optional) {
              return Effect.fail(
                invalid(
                  "An optional XML child sequence cannot distinguish absence from an empty fragment",
                  encoded,
                  parseOptions,
                ),
              );
            }
            if (!globalThis.Array.isArray(encoded) || !encoded.every(isChild)) {
              return Effect.fail(
                invalid("Expected an encoded XML child sequence", encoded, parseOptions),
              );
            }
            return Effect.map(
              validateOrderedChildren(encoded, content.ast, parseOptions),
              (children) => new AstFragment({ children }),
            );
          }
          if (encoded === undefined && optional) {
            return Effect.succeed(new AstFragment({ children: [] }));
          }
          if (!isChild(encoded)) {
            return Effect.fail(
              invalid("Expected one encoded XML fragment child", encoded, parseOptions),
            );
          }
          const children: ReadonlyArray<Child> = [encoded];
          return Effect.map(
            validateOrderedChildren(children, content.ast, parseOptions),
            (valid) => new AstFragment({ children: valid }),
          );
        },
      }),
    ),
  );

  return delegateRequired(
    codec,
    (effect, parseOptions) =>
      withXmlDecodeState(Effect.andThen(validateOptions(options, parseOptions), effect), true),
    (effect, parseOptions) =>
      Effect.suspend(() =>
        Effect.flatMap(validateOptions(options, parseOptions), (version) =>
          Effect.provideService(effect, CurrentEncodeState, {
            structured: new WeakSet(),
            typed: new WeakSet(),
            sortKeys:
              !Predicate.isObject(options) ||
              !Predicate.hasProperty(options, "sortKeys") ||
              options.sortKeys !== false,
            version,
          }),
        ),
      ),
  );
};
