import * as Schema from "effect/Schema";

import { Attribute } from "./attribute.ts";
import { Comment } from "./comment.ts";
import { Declaration } from "./declaration.ts";
import { Document } from "./document.ts";
import { Element } from "./element.ts";
import { Fragment } from "./fragment.ts";
import { Name } from "./name.ts";
import { NamespaceDeclaration } from "./namespace-declaration.ts";
import { ProcessingInstruction } from "./processing-instruction.ts";
import { CData, Text } from "./text.ts";

/** Any schema-backed XML AST value. */
export type Node =
  | Name
  | Attribute
  | NamespaceDeclaration
  | Declaration
  | Text
  | CData
  | Comment
  | ProcessingInstruction
  | Element
  | Fragment
  | Document;

/** Schema for all XML AST values. */
export const Node = Schema.Union([
  Name,
  Attribute,
  NamespaceDeclaration,
  Declaration,
  Text,
  CData,
  Comment,
  ProcessingInstruction,
  Element,
  Fragment,
  Document,
]);

/** Refines a value through Effect class recognition as an XML AST node. */
export const isNode = Schema.is(Node);
