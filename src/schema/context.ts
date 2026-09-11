import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import type * as SchemaIssue from "effect/SchemaIssue";

import type { Attribute } from "../ast/attribute.ts";
import { isElement, type Child, type Element } from "../ast/element.ts";
import type { Fragment } from "../ast/fragment.ts";
import type { Node } from "../ast/node.ts";
import { xmlNamespace } from "../namespace/validation.ts";
import type { ResolvedCodecName } from "./codec-name.ts";
import type { PlacementToken } from "./metadata.ts";
import { associateSource, sourceForIssue, type XmlLocation } from "./provenance.ts";

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

export type ProjectedNode = Node | ReadonlyArray<Node>;
export type DecodeRoot = Fragment | Child | ReadonlyArray<Child>;

export interface DecodeState {
  positions: WeakMap<Node, XmlLocation>;
  readonly projections: WeakMap<Element, ReadonlyMap<PropertyKey, ProjectedNode>>;
  readonly preservesSpace: WeakMap<Element, boolean>;
  root?: DecodeRoot;
  sourceRoot?: Node;
}

// RETURN TYPE: Narrows the provenance cursor's readonly-array union member.
const isNodeArray = (value: Node | ReadonlyArray<Node>): value is ReadonlyArray<Node> =>
  globalThis.Array.isArray(value);

/** Resolves a standard Effect issue path against the real parsed XML nodes. */
const locationAt = (state: DecodeState, path: ReadonlyArray<PropertyKey>) => {
  let current: Node | ReadonlyArray<Node> | undefined = state.root;
  let nearest =
    current === undefined || isNodeArray(current) ? undefined : state.positions.get(current);

  for (const key of path) {
    if (current === undefined) break;
    let next: Node | ReadonlyArray<Node> | undefined;
    if (isNodeArray(current)) {
      next = Predicate.isNumber(key) ? current[key] : undefined;
    } else if (Predicate.isTagged(current, "Fragment")) {
      if (key === "children") next = current.children;
      else next = Predicate.isNumber(key) ? current.children[key] : undefined;
    } else if (isElement(current)) {
      next = state.projections.get(current)?.get(key);
    } else {
      break;
    }
    if (next === undefined) break;
    current = next;
    if (!isNodeArray(current)) nearest = state.positions.get(current) ?? nearest;
  }

  if (current !== undefined && !isNodeArray(current)) {
    const location = state.positions.get(current);
    if (location !== undefined) return location;
  }
  return (
    nearest ?? (state.sourceRoot === undefined ? undefined : state.positions.get(state.sourceRoot))
  );
};

/** Runs one document or fragment decode with private location/projection state. */
export const withXmlDecodeState = <A, R>(
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
      Effect.mapError(effect, (issue) => {
        if (sourceForIssue(issue) !== undefined) return issue;
        return associateSource(issue, {
          location: (path) => locationAt(state, path),
        });
      }),
      CurrentDecodeState,
      state,
    );
  });

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
  readonly version: "1.0" | "1.1";
}

export const CurrentEncodeState = Context.Reference<EncodeState | undefined>(
  "effect-xml/schema/CurrentEncodeState",
  { defaultValue: () => undefined },
);
