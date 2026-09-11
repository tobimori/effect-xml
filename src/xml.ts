/** Effect Schema codecs for the production RSS XML slice. */

export { optional, optionalKey } from "effect/Schema";

export { Array } from "./schema/array.ts";
export { Attribute } from "./schema/attribute.ts";
export { Document, type DeclarationOptions, type DocumentOptions } from "./schema/document.ts";
export { DocumentNode, type DocumentNodeOptions } from "./schema/document-node.ts";
export { Element } from "./schema/element.ts";
export { formatError } from "./schema/format-error.ts";
export { Struct } from "./schema/struct.ts";
