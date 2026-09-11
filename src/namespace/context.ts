import * as Schema from "effect/Schema";

import { NamespaceBinding } from "./binding.ts";
import { validateBinding } from "./validation.ts";

const validateContext = (context: { readonly bindings: ReadonlyArray<NamespaceBinding> }) => {
  const prefixes = new Set<string | undefined>();
  const issues: Array<Schema.FilterIssue> = [];

  for (let index = 0; index < context.bindings.length; index++) {
    const binding = context.bindings[index];
    if (binding === undefined) continue;

    const bindingIssue = validateBinding(binding.prefix, binding.namespaceUri);
    if (bindingIssue !== undefined) {
      issues.push({ path: ["bindings", index], issue: bindingIssue });
    }

    if (prefixes.has(binding.prefix)) {
      issues.push({
        path: ["bindings", index, "prefix"],
        issue: `Namespace prefix ${JSON.stringify(binding.prefix)} occurs more than once`,
      });
    } else {
      prefixes.add(binding.prefix);
    }
  }

  return issues;
};

const NamespaceContextFields = Schema.Struct({
  bindings: Schema.Array(NamespaceBinding),
}).check(Schema.makeFilter(validateContext));

/** Validated namespace bindings inherited by standalone fragment codecs. */
export class NamespaceContext extends Schema.TaggedClass<NamespaceContext>(
  "effect-xml/Xml/NamespaceContext",
)("NamespaceContext", NamespaceContextFields) {}

/** Refines a value through Effect's NamespaceContext class recognition. */
export const isNamespaceContext = Schema.is(NamespaceContext);
