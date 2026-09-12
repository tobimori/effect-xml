import * as Schema from "effect/Schema";

import { lazy } from "../schema/lazy.ts";
import { Attribute, AttributeSchema } from "./attribute.ts";
import { Comment, CommentSchema } from "./comment.ts";
import { SourceSpan } from "./location.ts";
import { Name, NameSchema } from "./name.ts";
import { NamespaceDeclaration, NamespaceDeclarationSchema } from "./namespace-declaration.ts";
import { nodeCodec } from "./node-codec.ts";
import { ProcessingInstruction, ProcessingInstructionSchema } from "./processing-instruction.ts";
import { CData, CDataSchema, Text, TextSchema } from "./text.ts";

/** Content that may occur in an element or fragment. */
export type Child = Text | CData | Comment | ProcessingInstruction | Element;

/** The plain encoded representation of recursive element content. */
export type EncodedChild =
  | Schema.Codec.Encoded<typeof TextSchema>
  | Schema.Codec.Encoded<typeof CDataSchema>
  | Schema.Codec.Encoded<typeof CommentSchema>
  | Schema.Codec.Encoded<typeof ProcessingInstructionSchema>
  | EncodedElement;

/** The plain encoded representation of an Element class. */
export interface EncodedElement {
  readonly _tag: "Element";
  readonly name: Schema.Codec.Encoded<typeof NameSchema>;
  readonly namespaceDeclarations: ReadonlyArray<
    Schema.Codec.Encoded<typeof NamespaceDeclarationSchema>
  >;
  readonly attributes: ReadonlyArray<Schema.Codec.Encoded<typeof AttributeSchema>>;
  readonly children: ReadonlyArray<EncodedChild>;
  readonly span?: Schema.Codec.Encoded<typeof SourceSpan>;
}

const RecursiveChild = lazy((): Schema.Codec<Child, EncodedChild> => ChildNode);

const ElementEncoded = Schema.TaggedStruct("Element", {
  name: NameSchema,
  namespaceDeclarations: Schema.Array(NamespaceDeclarationSchema),
  attributes: Schema.Array(AttributeSchema),
  children: Schema.Array(RecursiveChild),
  span: Schema.optionalKey(SourceSpan),
});

type ElementFields = Omit<Schema.Schema.Type<typeof ElementEncoded>, "_tag">;

/** A namespace-resolved XML element with ordered attributes and children. */
export class Element {
  readonly _tag = "Element";
  declare readonly name: Name;
  declare readonly namespaceDeclarations: ReadonlyArray<NamespaceDeclaration>;
  declare readonly attributes: ReadonlyArray<Attribute>;
  declare readonly children: ReadonlyArray<Child>;
  declare readonly span?: SourceSpan;

  constructor(fields: ElementFields) {
    this.name = fields.name;
    this.namespaceDeclarations = fields.namespaceDeclarations;
    this.attributes = fields.attributes;
    this.children = fields.children;
    if (fields.span !== undefined) this.span = fields.span;
  }
}

/** Codec for validated Element nodes and their plain recursive representation. */
export const ElementSchema: Schema.Codec<Element, EncodedElement> = nodeCodec(
  ElementEncoded,
  Element,
  "effect-xml/XmlNode/Element",
);

/** Schema for ordered element and fragment content. */
export const ChildNode: Schema.Codec<Child, EncodedChild> = Schema.Union([
  TextSchema,
  CDataSchema,
  CommentSchema,
  ProcessingInstructionSchema,
  ElementSchema,
]);

/** Refines a value through Element class identity. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public predicate checks ordinary node class identity.
export const isElement = (input: unknown): input is Element => input instanceof Element;

/** Refines a value through class identity as element content. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public predicate checks the closed node class union.
export const isChild = (input: unknown): input is Child =>
  input instanceof Text ||
  input instanceof CData ||
  input instanceof Comment ||
  input instanceof ProcessingInstruction ||
  input instanceof Element;
