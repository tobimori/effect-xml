import * as Schema from "effect/Schema";

import { validateBinding } from "./validation.ts";

const NamespaceBindingFields = Schema.Struct({
  namespaceUri: Schema.String,
  prefix: Schema.optionalKey(Schema.String),
}).check(Schema.makeFilter((binding) => validateBinding(binding.prefix, binding.namespaceUri)));

/** A validated XML namespace binding. An omitted prefix denotes the default namespace. */
export class NamespaceBinding extends Schema.TaggedClass<NamespaceBinding>(
  "effect-xml/Xml/NamespaceBinding",
)("NamespaceBinding", NamespaceBindingFields) {}

/** Refines a value through Effect's NamespaceBinding class recognition. */
export const isNamespaceBinding = Schema.is(NamespaceBinding);
