import * as Predicate from "effect/Predicate";

import type { Name } from "../namespace/name.ts";

/** Private name shape retained in placement metadata until a Struct supplies a local name. */
export interface CodecName {
  readonly localName?: string;
  readonly namespaceUri?: string;
  readonly prefix?: string;
}

/** A codec name after either an explicit name or a Struct field key supplied the local name. */
export interface ResolvedCodecName extends CodecName {
  readonly localName: string;
}

interface MutableCodecName {
  localName?: string;
  namespaceUri?: string;
  prefix?: string;
}

/** Copies a public name input over optional private namespace defaults. */
export const codecNameFrom = (
  input: string | Name | undefined,
  defaults: CodecName = {},
): CodecName => {
  if (Predicate.isString(input)) return { ...defaults, localName: input };
  if (input === undefined) return { ...defaults };
  const fields: MutableCodecName = { localName: input.localName };
  if (input.namespaceUri !== undefined) fields.namespaceUri = input.namespaceUri;
  if (input.prefix !== undefined) fields.prefix = input.prefix;
  return fields;
};

/** Supplies a field-key local name without changing retained namespace preferences. */
export const withLocalName = (name: CodecName, localName: string): ResolvedCodecName => ({
  ...name,
  localName: name.localName ?? localName,
});

/** Resolves a placement name only when it already carries a local name. */
export const resolvedCodecName = (name: CodecName) =>
  name.localName === undefined ? undefined : withLocalName(name, name.localName);

/** Tests expanded-name identity; serialization prefixes are intentionally ignored. */
export const hasExpandedName = (
  actual: { readonly localName: string; readonly namespaceUri?: string },
  expected: ResolvedCodecName,
) => actual.localName === expected.localName && actual.namespaceUri === expected.namespaceUri;

/** Keeps existing unnamespaced diagnostics while making namespaced expectations unambiguous. */
export const codecNameLabel = (name: ResolvedCodecName) =>
  name.namespaceUri === undefined ? name.localName : `{${name.namespaceUri}}${name.localName}`;
