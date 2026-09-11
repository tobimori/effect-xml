import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import type * as SchemaIssue from "effect/SchemaIssue";

import type { Attribute } from "../ast/attribute.ts";
import { isElement, type Child, type Element } from "../ast/element.ts";
import type { Fragment } from "../ast/fragment.ts";
import type { Node } from "../ast/node.ts";
import type { NamespaceContext } from "../namespace/context.ts";
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

/** One parent-linked namespace declaration delta in an active XML decode. */
export interface XmlNamespaceScope {
  readonly parent?: XmlNamespaceScope;
  readonly bindings: ReadonlyArray<{
    readonly prefix?: string;
    readonly namespaceUri: string;
  }>;
}

export interface DecodeState {
  positions: WeakMap<Node, XmlLocation>;
  readonly projections: WeakMap<Element, ReadonlyMap<PropertyKey, ProjectedNode>>;
  readonly preservesSpace: WeakMap<Element, boolean>;
  /** False-nil source elements mapped to the views used only for schema projection. */
  projectionAliases?: WeakMap<Element, Element>;
  /** Element scopes are registered lazily as typed traversal reaches each element. */
  namespaceScopes?: WeakMap<Element, XmlNamespaceScope>;
  namespaceRoot?: XmlNamespaceScope;
  root?: DecodeRoot;
  sourceRoot?: Node;
}

/** Starts a linked scope chain from a fragment's validated inherited bindings. */
export const rootXmlNamespaceScope = (inherited?: NamespaceContext): XmlNamespaceScope => ({
  bindings: inherited?.bindings ?? [],
});

/** Adds one element declaration delta without materializing inherited bindings. */
export const enterXmlNamespaceScope = (
  parent: XmlNamespaceScope,
  element: Element,
): XmlNamespaceScope => ({
  parent,
  bindings: element.namespaceDeclarations,
});

/** Sets the inherited root scope without walking any element content. */
export const initializeXmlNamespaceScopes = (
  state: DecodeState | undefined,
  inherited?: NamespaceContext,
) => {
  const root = rootXmlNamespaceScope(inherited);
  if (state !== undefined) {
    state.namespaceRoot = root;
    state.namespaceScopes ??= new WeakMap();
  }
  return root;
};

/** Registers or returns one element's linked scope. The caller supplies its parent scope. */
export const registerXmlNamespaceScope = (
  state: DecodeState | undefined,
  element: Element,
  parent?: XmlNamespaceScope,
) => {
  const cached = state?.namespaceScopes?.get(element);
  if (cached !== undefined) return cached;
  const inherited = parent ?? state?.namespaceRoot ?? rootXmlNamespaceScope();
  const scope = enterXmlNamespaceScope(inherited, element);
  if (state !== undefined) {
    state.namespaceScopes ??= new WeakMap();
    state.namespaceScopes.set(element, scope);
  }
  return scope;
};

/** Returns an element's already registered linked namespace scope. */
export const xmlNamespaceScopeFor = (state: DecodeState | undefined, element: Element) =>
  state?.namespaceScopes?.get(element);

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
      let projection: Element = current;
      const seen = new Set<Element>();
      while (!seen.has(projection)) {
        seen.add(projection);
        const alias = state.projectionAliases?.get(projection);
        if (alias === undefined) break;
        projection = alias;
      }
      next = state.projections.get(projection)?.get(key);
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
      projectionAliases: new WeakMap(),
      namespaceScopes: new WeakMap(),
      namespaceRoot: rootXmlNamespaceScope(),
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

/** Registers a projection-only element alias while retaining original source locations. */
export const registerProjectionAlias = (
  state: DecodeState | undefined,
  source: Element,
  projected: Element,
) => {
  if (state === undefined) return;
  state.projectionAliases ??= new WeakMap();
  state.projectionAliases.set(source, projected);

  const location = state.positions.get(source);
  if (location !== undefined) state.positions.set(projected, location);
  const preservesSpace = state.preservesSpace.get(source);
  if (preservesSpace !== undefined) state.preservesSpace.set(projected, preservesSpace);
  const namespaceScope = state.namespaceScopes?.get(source);
  if (namespaceScope !== undefined) {
    state.namespaceScopes ??= new WeakMap();
    state.namespaceScopes.set(projected, namespaceScope);
  }
};

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
  /** Raw Rest attributes whose lexical prefixes must remain fixed on typed owners. */
  rawAttributes?: WeakSet<Attribute>;
  /** Effective Rest namespace snapshots restored before typed name allocation. */
  restNamespaces?: WeakMap<Element, NamespaceContext>;
}

/** Marks raw Rest attributes without requiring every existing encode-state caller to initialize it. */
export const registerRawRestAttributes = (
  state: EncodeState | undefined,
  attributes: ReadonlyArray<Attribute>,
) => {
  if (state === undefined || attributes.length === 0) return;
  state.rawAttributes ??= new WeakSet();
  for (const attribute of attributes) state.rawAttributes.add(attribute);
};

/** Associates a typed owning element with the effective Rest scope it must restore. */
export const registerRestNamespaceSnapshot = (
  state: EncodeState | undefined,
  element: Element,
  namespaces: NamespaceContext,
) => {
  if (state === undefined) return;
  state.restNamespaces ??= new WeakMap();
  state.restNamespaces.set(element, namespaces);
};

export const CurrentEncodeState = Context.Reference<EncodeState | undefined>(
  "effect-xml/schema/CurrentEncodeState",
  { defaultValue: () => undefined },
);
