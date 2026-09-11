import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import type { Attribute } from "./attribute.ts";
import type { Element } from "./element.ts";
import { equalsName, type ExpandedName } from "./expanded-name.ts";
import type { Node } from "./node.ts";

/** A natural unnamespaced local name or a structural expanded name. */
export type NameInput = string | ExpandedName;

const matchesName = (actual: ExpandedName, expected: NameInput) =>
  Predicate.isString(expected)
    ? actual.localName === expected && actual.namespaceUri === undefined
    : equalsName(actual, expected);

/** Finds the first attribute with the requested expanded name. */
export const getAttribute = (element: Element, name: NameInput): Option.Option<Attribute> => {
  for (const attribute of element.attributes) {
    if (matchesName(attribute.name, name)) return Option.some(attribute);
  }
  return Option.none();
};

/** Returns direct element children, optionally filtered by expanded name. */
export const getChildren = (element: Element, name?: NameInput): ReadonlyArray<Element> => {
  const children: Array<Element> = [];
  for (const child of element.children) {
    if (
      Predicate.isTagged(child, "Element") &&
      (name === undefined || matchesName(child.name, name))
    ) {
      children.push(child);
    }
  }
  return children;
};

/** Concatenates direct text and CDATA content without descending into child elements. */
export const getText = (element: Element) => {
  let text = "";
  for (const child of element.children) {
    if (Predicate.isTagged(child, "Text") || Predicate.isTagged(child, "CData")) {
      text += child.value;
    }
  }
  return text;
};

/** Visits an XML node and its XML content in iterative preorder. */
export const walk = (node: Node, visitor: (node: Node) => void) => {
  const pending: Array<Node> = [node];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    visitor(current);

    if (Predicate.isTagged(current, "Element") || Predicate.isTagged(current, "Fragment")) {
      for (let index = current.children.length - 1; index >= 0; index--) {
        pending.push(current.children[index]!);
      }
    } else if (Predicate.isTagged(current, "Document")) {
      for (let index = current.epilog.length - 1; index >= 0; index--) {
        pending.push(current.epilog[index]!);
      }
      pending.push(current.root);
      for (let index = current.prolog.length - 1; index >= 0; index--) {
        pending.push(current.prolog[index]!);
      }
      if (current.declaration !== undefined) pending.push(current.declaration);
    }
  }
};
