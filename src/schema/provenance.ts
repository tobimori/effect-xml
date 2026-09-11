import type * as SchemaIssue from "effect/SchemaIssue";

/** A position in the XML source that produced a schema issue. */
export interface XmlLocation {
  readonly source?: string;
  readonly start: number;
  readonly line: number;
  readonly column: number;
}

/** Resolves issue paths relative to one XML document. */
export interface SourceLookup {
  readonly location: (
    path: ReadonlyArray<PropertyKey>,
    issue: SchemaIssue.Issue,
  ) => XmlLocation | undefined;
}

const sources = new WeakMap<SchemaIssue.Issue, SourceLookup>();

/** Associates a document's root issue with its private source lookup. */
export const associateSource = (issue: SchemaIssue.Issue, source: SourceLookup) => {
  sources.set(issue, source);
  return issue;
};

/** Returns source provenance registered for this exact issue node. */
export const sourceForIssue = (issue: SchemaIssue.Issue) => sources.get(issue);
