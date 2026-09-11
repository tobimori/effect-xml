import * as Context from "effect/Context";
import type * as SchemaIssue from "effect/SchemaIssue";

import type { Attribute } from "../ast/attribute.ts";
import type { Element } from "../ast/element.ts";
import type { Node } from "../ast/node.ts";
import { xmlNamespace } from "../namespace/validation.ts";
import type { ResolvedCodecName } from "./codec-name.ts";
import type { PlacementToken } from "./metadata.ts";
import type { XmlLocation } from "./provenance.ts";

export interface PlacementBindingsState {
  readonly parent?: PlacementBindingsState;
  readonly token?: PlacementToken;
  readonly name?: ResolvedCodecName;
}

export const PlacementBindings = Context.Reference<PlacementBindingsState>(
  "effect-xml/schema/PlacementBindings",
  { defaultValue: () => ({}) },
);

export const resolvePlacementName = (initial: PlacementBindingsState, token: PlacementToken) => {
  let scope: PlacementBindingsState | undefined = initial;
  while (scope !== undefined) {
    if (scope.token === token) return scope.name;
    scope = scope.parent;
  }
  return undefined;
};

export interface StructDecodeIssuesState {
  readonly issues: Array<SchemaIssue.Issue>;
  input?: unknown;
}

export const CurrentStructDecodeIssues = Context.Reference<StructDecodeIssuesState | undefined>(
  "effect-xml/schema/CurrentStructDecodeIssues",
  { defaultValue: () => undefined },
);

export type ProjectedNode = Element["attributes"][number] | Element | ReadonlyArray<Element>;

export interface DecodeState {
  positions: WeakMap<Node, XmlLocation>;
  readonly projections: WeakMap<Element, ReadonlyMap<PropertyKey, ProjectedNode>>;
  readonly preservesSpace: WeakMap<Element, boolean>;
  root?: Element;
}

/** Recognizes the namespace-resolved xml:space control attribute. */
export const isXmlSpaceAttribute = (attribute: Attribute) =>
  attribute.name.localName === "space" && attribute.name.namespaceUri === xmlNamespace;

/** Records an element's inherited xml:space mode for later structured projection. */
export const registerXmlSpace = (
  state: DecodeState | undefined,
  element: Element,
  inherited = false,
) => {
  const cached = state?.preservesSpace.get(element);
  if (cached !== undefined) return cached;
  const control = element.attributes.find(isXmlSpaceAttribute);
  let preserved = inherited;
  if (control?.value === "preserve") preserved = true;
  else if (control?.value === "default") preserved = false;
  state?.preservesSpace.set(element, preserved);
  return preserved;
};

export const CurrentDecodeState = Context.Reference<DecodeState | undefined>(
  "effect-xml/schema/CurrentDecodeState",
  { defaultValue: () => undefined },
);

export interface EncodeState {
  readonly structured: WeakSet<Element>;
  readonly typed: WeakSet<Element>;
  readonly sortKeys: boolean;
}

export const CurrentEncodeState = Context.Reference<EncodeState | undefined>(
  "effect-xml/schema/CurrentEncodeState",
  { defaultValue: () => undefined },
);
