import * as Predicate from "effect/Predicate";

interface ElementCandidate {
  readonly children: ReadonlyArray<unknown>;
}

interface Visit {
  readonly element: ElementCandidate;
  readonly exiting: boolean;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Cycle preflight intentionally inspects unknown encoded nodes.
const elementCandidate = (value: unknown): value is ElementCandidate => {
  try {
    return (
      Predicate.isTagged(value, "Element") &&
      Predicate.hasProperty(value, "children") &&
      Array.isArray(value.children)
    );
  } catch {
    return false;
  }
};

/** Detects structural cycles through Element.children while allowing completed shared subtrees. */
export const hasElementChildCycle = (roots: ReadonlyArray<unknown>) => {
  const work: Array<Visit> = [];
  for (let index = roots.length - 1; index >= 0; index--) {
    const root = roots[index];
    if (elementCandidate(root)) work.push({ element: root, exiting: false });
  }

  const states = new WeakMap<object, "active" | "complete">();
  while (work.length > 0) {
    const visit = work.pop()!;
    if (visit.exiting) {
      states.set(visit.element, "complete");
      continue;
    }

    const state = states.get(visit.element);
    if (state === "active") return true;
    if (state === "complete") continue;
    states.set(visit.element, "active");
    work.push({ element: visit.element, exiting: true });
    let children: ReadonlyArray<unknown>;
    try {
      children = visit.element.children;
    } catch {
      continue;
    }
    if (!Array.isArray(children)) continue;
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index];
      if (elementCandidate(child)) work.push({ element: child, exiting: false });
    }
  }
  return false;
};
