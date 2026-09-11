import type * as Result from "effect/Result";
import type * as SchemaIssue from "effect/SchemaIssue";

import { parseDocumentChunks, parseFragmentChunks } from "./chunk-parser.ts";
import type {
  FragmentParseOptions,
  ParsedDocument,
  ParsedFragment,
  ParseOptions,
} from "./types.ts";

export type {
  FragmentParseOptions,
  ParsedDocument,
  ParsedFragment,
  ParseOptions,
  ParserLimits,
} from "./types.ts";

/** Parses one namespace-aware XML document from a JavaScript string. */
// RETURN TYPE: Keeps the parser-to-schema contract stable for sibling modules.
export const parseDocument = (
  input: string,
  options: ParseOptions = {},
): Result.Result<ParsedDocument, SchemaIssue.Issue> => parseDocumentChunks([input], options);

/** Parses declaration-free, namespace-aware XML content from a JavaScript string. */
// RETURN TYPE: Exposes the fragment AST and original-input source positions.
export const parseFragment = (
  input: string,
  options: FragmentParseOptions = {},
): Result.Result<ParsedFragment, SchemaIssue.Issue> => parseFragmentChunks([input], options);
