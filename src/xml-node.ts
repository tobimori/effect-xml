/** Typed XML syntax storage classes and their validating codecs. */

export { Attribute, AttributeSchema, isAttribute } from "./ast/attribute.ts";
export { Comment, CommentSchema, isComment } from "./ast/comment.ts";
export { Declaration, DeclarationSchema, isDeclaration } from "./ast/declaration.ts";
export {
  Document,
  DocumentSchema,
  isDocument,
  isMisc,
  MiscNode,
  type Misc,
} from "./ast/document.ts";
export {
  ChildNode,
  Element,
  ElementSchema,
  isChild,
  isElement,
  type Child,
  type EncodedChild,
  type EncodedElement,
} from "./ast/element.ts";
export { Fragment, FragmentSchema, isFragment } from "./ast/fragment.ts";
export { isSourceSpan, SourceSpan } from "./ast/location.ts";
export { equalsName, type ExpandedName } from "./ast/expanded-name.ts";
export { isName, Name, NameSchema } from "./ast/name.ts";
export { getAttribute, getChildren, getText, walk, type NameInput } from "./ast/navigation.ts";
export {
  isNamespaceDeclaration,
  NamespaceDeclaration,
  NamespaceDeclarationSchema,
} from "./ast/namespace-declaration.ts";
export { isNode, Node } from "./ast/node.ts";
export {
  isProcessingInstruction,
  ProcessingInstruction,
  ProcessingInstructionSchema,
} from "./ast/processing-instruction.ts";
export { CData, CDataSchema, isCData, isText, Text, TextSchema } from "./ast/text.ts";
