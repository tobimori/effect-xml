import * as Schema from "effect/Schema";

import { Comment, CommentSchema } from "./comment.ts";
import { Declaration, DeclarationSchema } from "./declaration.ts";
import { Element, ElementSchema } from "./element.ts";
import { SourceSpan } from "./location.ts";
import { nodeCodec } from "./node-codec.ts";
import { ProcessingInstruction, ProcessingInstructionSchema } from "./processing-instruction.ts";

/** Schema for document prolog and epilog nodes. */
export const MiscNode = Schema.Union([CommentSchema, ProcessingInstructionSchema]);

/** Content permitted before and after a document root. */
export type Misc = Schema.Schema.Type<typeof MiscNode>;

const DocumentEncoded = Schema.TaggedStruct("Document", {
  declaration: Schema.optionalKey(DeclarationSchema),
  prolog: Schema.Array(MiscNode),
  root: ElementSchema,
  epilog: Schema.Array(MiscNode),
  span: Schema.optionalKey(SourceSpan),
});

type DocumentFields = Omit<Schema.Schema.Type<typeof DocumentEncoded>, "_tag">;

/** An XML document with exactly one root element. */
export class Document {
  readonly _tag = "Document";
  declare readonly declaration?: Declaration;
  declare readonly prolog: ReadonlyArray<Misc>;
  declare readonly root: Element;
  declare readonly epilog: ReadonlyArray<Misc>;
  declare readonly span?: SourceSpan;

  constructor(fields: DocumentFields) {
    if (fields.declaration !== undefined) this.declaration = fields.declaration;
    this.prolog = fields.prolog;
    this.root = fields.root;
    this.epilog = fields.epilog;
    if (fields.span !== undefined) this.span = fields.span;
  }
}

/** Codec for validated Document nodes and their plain representation. */
export const DocumentSchema: Schema.Codec<
  Document,
  Schema.Codec.Encoded<typeof DocumentEncoded>
> = nodeCodec(DocumentEncoded, Document, "effect-xml/XmlNode/Document");

/** Refines a value through class identity as document misc content. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public predicate checks the closed node class union.
export const isMisc = (input: unknown): input is Misc =>
  input instanceof Comment || input instanceof ProcessingInstruction;

/** Refines a value through Document class identity. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public predicate checks ordinary node class identity.
export const isDocument = (input: unknown): input is Document => input instanceof Document;
