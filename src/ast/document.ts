import * as Schema from "effect/Schema";

import { Comment } from "./comment.ts";
import { Declaration } from "./declaration.ts";
import { Element } from "./element.ts";
import { SourceSpan } from "./location.ts";
import { ProcessingInstruction } from "./processing-instruction.ts";

/** Content permitted before and after a document root. */
export type Misc = Comment | ProcessingInstruction;

/** Schema for document prolog and epilog nodes. */
export const MiscNode = Schema.Union([Comment, ProcessingInstruction]);

/** An XML document with exactly one root element. */
export class Document extends Schema.TaggedClass<Document>("effect-xml/XmlNode/Document")(
  "Document",
  {
    declaration: Schema.optionalKey(Declaration),
    prolog: Schema.Array(MiscNode),
    root: Element,
    epilog: Schema.Array(MiscNode),
    span: Schema.optionalKey(SourceSpan),
  },
) {}

/** Refines a value through Effect class recognition as document misc content. */
export const isMisc = Schema.is(MiscNode);

/** Refines a value through Effect's Document class recognition. */
export const isDocument = Schema.is(Document);
