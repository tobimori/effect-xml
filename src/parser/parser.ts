import type * as Result from "effect/Result";
import type * as SchemaIssue from "effect/SchemaIssue";

import { parseDocumentChunks } from "./chunk-parser.ts";
import type { ParsedDocument, ParseOptions } from "./types.ts";

export type { ParsedDocument, ParseOptions, ParserLimits } from "./types.ts";

/** Parses one namespace-aware XML 1.0 document from a JavaScript string. */
// RETURN TYPE: Keeps the parser-to-schema contract stable for sibling modules.
export const parseDocument = (
  input: string,
  options: ParseOptions = {},
): Result.Result<ParsedDocument, SchemaIssue.Issue> => parseDocumentChunks([input], options);
