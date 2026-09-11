import type { Document } from "../ast/document.ts";
import type { Node } from "../ast/node.ts";
import type { XmlLocation } from "../schema/provenance.ts";

/** Optional parser resource ceilings. Omitted limits are unlimited. */
export interface ParserLimits {
  /** Original JavaScript-string UTF-16 code units. */
  readonly inputLength?: number;
  /** Open element count, with the root at depth one. */
  readonly depth?: number;
  /** Elements, Text, CData, Comment, and ProcessingInstruction nodes. */
  readonly nodes?: number;
  /** Lexical attributes on one element, including namespace declarations. */
  readonly attributesPerElement?: number;
  /** Decoded UTF-16 units in text, CDATA, comments, PI data, and attributes (xmlns included). */
  readonly textLength?: number;
}

export interface ParseOptions {
  readonly locations?: boolean;
  readonly limits?: ParserLimits;
}

export interface ParsedDocument {
  readonly document: Document;
  readonly positions: WeakMap<Node, XmlLocation>;
}
