import * as Schema from "effect/Schema";

import { Attribute, AttributeSchema } from "./attribute.ts";
import { Comment, CommentSchema } from "./comment.ts";
import { Declaration, DeclarationSchema } from "./declaration.ts";
import { Document, DocumentSchema } from "./document.ts";
import { Element, ElementSchema } from "./element.ts";
import { Fragment, FragmentSchema } from "./fragment.ts";
import { Name, NameSchema } from "./name.ts";
import { NamespaceDeclaration, NamespaceDeclarationSchema } from "./namespace-declaration.ts";
import { ProcessingInstruction, ProcessingInstructionSchema } from "./processing-instruction.ts";
import { CData, CDataSchema, Text, TextSchema } from "./text.ts";

/** Schema for all XML AST values. */
export const Node = Schema.Union([
  NameSchema,
  AttributeSchema,
  NamespaceDeclarationSchema,
  DeclarationSchema,
  TextSchema,
  CDataSchema,
  CommentSchema,
  ProcessingInstructionSchema,
  ElementSchema,
  FragmentSchema,
  DocumentSchema,
]);

/** Any XML AST storage node. */
export type Node = Schema.Schema.Type<typeof Node>;

/** Refines a value through class identity as an XML AST node. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public predicate checks the closed node class union.
export const isNode = (input: unknown): input is Node =>
  input instanceof Name ||
  input instanceof Attribute ||
  input instanceof NamespaceDeclaration ||
  input instanceof Declaration ||
  input instanceof Text ||
  input instanceof CData ||
  input instanceof Comment ||
  input instanceof ProcessingInstruction ||
  input instanceof Element ||
  input instanceof Fragment ||
  input instanceof Document;
