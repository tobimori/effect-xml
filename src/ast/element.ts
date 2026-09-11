import * as Schema from "effect/Schema";

import { lazy } from "../schema/lazy.ts";
import { Attribute } from "./attribute.ts";
import { Comment } from "./comment.ts";
import { SourceSpan } from "./location.ts";
import { Name } from "./name.ts";
import { NamespaceDeclaration } from "./namespace-declaration.ts";
import { ProcessingInstruction } from "./processing-instruction.ts";
import { CData, Text } from "./text.ts";

/** Content that may occur in an element or fragment. */
export type Child = Text | CData | Comment | ProcessingInstruction | Element;

/** The plain encoded representation of recursive element content. */
export type EncodedChild =
  | Schema.Codec.Encoded<typeof Text>
  | Schema.Codec.Encoded<typeof CData>
  | Schema.Codec.Encoded<typeof Comment>
  | Schema.Codec.Encoded<typeof ProcessingInstruction>
  | EncodedElement;

/** The plain encoded representation of an Element class. */
export interface EncodedElement {
  readonly _tag: "Element";
  readonly name: Schema.Codec.Encoded<typeof Name>;
  readonly namespaceDeclarations: ReadonlyArray<Schema.Codec.Encoded<typeof NamespaceDeclaration>>;
  readonly attributes: ReadonlyArray<Schema.Codec.Encoded<typeof Attribute>>;
  readonly children: ReadonlyArray<EncodedChild>;
  readonly span?: Schema.Codec.Encoded<typeof SourceSpan>;
}

const RecursiveChild = lazy((): Schema.Codec<Child, EncodedChild> => ChildNode);

/** A namespace-resolved XML element with ordered attributes and children. */
export class Element extends Schema.TaggedClass<Element>("effect-xml/XmlNode/Element")("Element", {
  name: Name,
  namespaceDeclarations: Schema.Array(NamespaceDeclaration),
  attributes: Schema.Array(Attribute),
  children: Schema.Array(RecursiveChild),
  span: Schema.optionalKey(SourceSpan),
}) {}

/** Schema for ordered element and fragment content. */
export const ChildNode: Schema.Codec<Child, EncodedChild> = Schema.Union([
  Text,
  CData,
  Comment,
  ProcessingInstruction,
  Element,
]);

/** Refines a value through Effect's Element class recognition. */
export const isElement = Schema.is(Element);

/** Refines a value through Effect class recognition as element content. */
export const isChild = Schema.is(ChildNode);
