/** Schema-backed immutable XML syntax values. */

export { Attribute, isAttribute } from "./ast/attribute.ts";
export { Comment, isComment } from "./ast/comment.ts";
export { Declaration, isDeclaration } from "./ast/declaration.ts";
export { Document, isDocument, isMisc, MiscNode, type Misc } from "./ast/document.ts";
export {
  ChildNode,
  Element,
  isChild,
  isElement,
  type Child,
  type EncodedChild,
  type EncodedElement,
} from "./ast/element.ts";
export { Fragment, isFragment } from "./ast/fragment.ts";
export { isSourceSpan, SourceSpan } from "./ast/location.ts";
export { equalsName, isName, Name } from "./ast/name.ts";
export { isNamespaceDeclaration, NamespaceDeclaration } from "./ast/namespace-declaration.ts";
export { isNode, Node } from "./ast/node.ts";
export { isProcessingInstruction, ProcessingInstruction } from "./ast/processing-instruction.ts";
export { CData, isCData, isText, Text } from "./ast/text.ts";
