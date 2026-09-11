import * as Predicate from "effect/Predicate";
import type * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

import { sourceForIssue, type SourceLookup } from "./provenance.ts";

const formatShallow = SchemaIssue.makeFormatterDefault();

const findMessage = (initialIssue: SchemaIssue.Issue) => {
  let issue = initialIssue;
  while (Predicate.isTagged(issue, "Encoding")) issue = issue.issue;

  let message: unknown;
  if (Predicate.isTagged(issue, "Pointer")) return undefined;
  if (Predicate.isTagged(issue, "Filter")) {
    message = issue.filter.annotations?.message;
  } else if (Predicate.isTagged(issue, "InvalidValue") || Predicate.isTagged(issue, "Forbidden")) {
    message = issue.annotations?.message;
  } else if (Predicate.isTagged(issue, "MissingKey")) {
    message = issue.annotations?.messageMissingKey;
  } else if (Predicate.isTagged(issue, "UnexpectedKey")) {
    message = issue.ast.annotations?.["messageUnexpectedKey"];
  } else {
    message = issue.ast.annotations?.["message"];
  }
  return Predicate.isString(message) ? message : undefined;
};

const findFilterMessage = (issue: SchemaIssue.Filter) =>
  findMessage(issue.issue) ?? findMessage(issue);

interface PathFrame {
  readonly parent: PathFrame | undefined;
  readonly path: ReadonlyArray<PropertyKey>;
  readonly length: number;
}

interface Work {
  readonly issue: SchemaIssue.Issue;
  readonly path: PathFrame | undefined;
  readonly source: SourceLookup | undefined;
  readonly sourcePathStart: number;
}

const flattenPath = (initialFrame: PathFrame | undefined) => {
  const frames: Array<ReadonlyArray<PropertyKey>> = [];
  let frame = initialFrame;
  let length = 0;

  while (frame !== undefined) {
    frames.push(frame.path);
    length += frame.path.length;
    frame = frame.parent;
  }

  const path: Array<PropertyKey> = [];
  path.length = length;
  let pathIndex = 0;
  for (let frameIndex = frames.length - 1; frameIndex >= 0; frameIndex--) {
    const segment = frames[frameIndex];
    if (segment === undefined) continue;
    for (const key of segment) path[pathIndex++] = key;
  }
  return path;
};

const formatPath = (path: ReadonlyArray<PropertyKey>) => {
  let output = "";
  for (const key of path) {
    output += `[${Predicate.isString(key) ? JSON.stringify(key) : String(key)}]`;
  }
  return output;
};

const withContext = (
  initialMessage: string,
  path: ReadonlyArray<PropertyKey>,
  issue: SchemaIssue.Issue,
  source: SourceLookup | undefined,
  sourcePathStart: number,
) => {
  let message = initialMessage;
  const location = source?.location(path.slice(sourcePathStart), issue);
  if (location !== undefined) {
    const sourceName = location.source === undefined ? "" : ` ${location.source}`;
    message += `\n  at XML${sourceName}, line ${location.line}, column ${location.column} (offset ${location.start})`;
  }
  return path.length === 0 ? message : `${message}\n  at ${formatPath(path)}`;
};

const pushChildren = (
  work: Array<Work>,
  issues: ReadonlyArray<SchemaIssue.Issue>,
  makeWork: (issue: SchemaIssue.Issue) => Work,
) => {
  for (let index = issues.length - 1; index >= 0; index--) {
    const issue = issues[index];
    if (issue !== undefined) work.push(makeWork(issue));
  }
};

/** Formats a schema error with locations from its registered XML provenance. */
export const formatError = (error: Schema.SchemaError) => {
  const output: Array<string> = [];
  const work: Array<Work> = [
    { issue: error.issue, path: undefined, source: undefined, sourcePathStart: 0 },
  ];

  while (work.length > 0) {
    const current = work.pop();
    if (current === undefined) continue;

    const issue = current.issue;
    const localSource = sourceForIssue(issue);
    const source = localSource ?? current.source;
    const sourcePathStart =
      localSource === undefined ? current.sourcePathStart : (current.path?.length ?? 0);
    const makeWork = (child: SchemaIssue.Issue, path = current.path) => ({
      issue: child,
      path,
      source,
      sourcePathStart,
    });

    if (Predicate.isTagged(issue, "Pointer")) {
      work.push(
        makeWork(issue.issue, {
          parent: current.path,
          path: issue.path,
          length: (current.path?.length ?? 0) + issue.path.length,
        }),
      );
      continue;
    }
    if (Predicate.isTagged(issue, "Encoding")) {
      work.push(makeWork(issue.issue));
      continue;
    }
    if (Predicate.isTagged(issue, "Composite")) {
      pushChildren(work, issue.issues, makeWork);
      continue;
    }
    if (Predicate.isTagged(issue, "AnyOf") && issue.issues.length > 0) {
      pushChildren(work, issue.issues, makeWork);
      continue;
    }

    if (Predicate.isTagged(issue, "Filter")) {
      const customMessage = findFilterMessage(issue);
      if (customMessage === undefined && !Predicate.isTagged(issue.issue, "InvalidValue")) {
        work.push(makeWork(issue.issue));
        continue;
      }
      const path = flattenPath(current.path);
      output.push(
        withContext(customMessage ?? formatShallow(issue), path, issue, source, sourcePathStart),
      );
      continue;
    }

    const path = flattenPath(current.path);
    const message = Predicate.isTagged(issue, "AnyOf")
      ? formatShallow(issue)
      : SchemaIssue.defaultLeafHook(issue);
    output.push(withContext(message, path, issue, source, sourcePathStart));
  }

  return output.join("\n");
};
