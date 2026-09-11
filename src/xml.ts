/** Effect Schema codecs for XML. */

export { optional, optionalKey } from "effect/Schema";

export { NamespaceBinding, isNamespaceBinding } from "./namespace/binding.ts";
export { NamespaceContext, isNamespaceContext } from "./namespace/context.ts";
export { Name, isName } from "./namespace/name.ts";
export { Namespace } from "./namespace/namespace.ts";

export { Array } from "./schema/array.ts";
export { Attribute } from "./schema/attribute.ts";
export { CData } from "./schema/cdata.ts";
export { Comment } from "./schema/comment.ts";
export { Document, type DeclarationOptions, type DocumentOptions } from "./schema/document.ts";
export { DocumentNode, type DocumentNodeOptions } from "./schema/document-node.ts";
export { Element } from "./schema/element.ts";
export { Fragment, type FragmentOptions } from "./schema/fragment.ts";
export { FragmentNode, type FragmentNodeOptions } from "./schema/fragment-node.ts";
export { formatError } from "./schema/format-error.ts";
export { fromSchema, type FromSchemaOptions } from "./schema/from-schema.ts";
export { Nil } from "./schema/nil.ts";
export { ProcessingInstruction } from "./schema/processing-instruction.ts";
export { Rest } from "./schema/rest.ts";
export { Struct } from "./schema/struct.ts";
export { suspend, type Suspend } from "./schema/suspend.ts";
export { Text } from "./schema/text.ts";
export { Tuple } from "./schema/tuple.ts";
export { Union } from "./schema/union.ts";
