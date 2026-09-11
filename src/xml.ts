/** Effect Schema codecs for XML. */

export { optional, optionalKey } from "effect/Schema";

export { NamespaceBinding, isNamespaceBinding } from "./namespace/binding.ts";
export { NamespaceContext, isNamespaceContext } from "./namespace/context.ts";
export { Name, isName } from "./namespace/name.ts";
export { Namespace } from "./namespace/namespace.ts";

export { Array } from "./schema/array.ts";
export { Attribute } from "./schema/attribute.ts";
export { Document, type DeclarationOptions, type DocumentOptions } from "./schema/document.ts";
export { DocumentNode, type DocumentNodeOptions } from "./schema/document-node.ts";
export { Element } from "./schema/element.ts";
export { formatError } from "./schema/format-error.ts";
export { Struct } from "./schema/struct.ts";
