import * as Effect from "effect/Effect";
import type * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";

import { isComment } from "../ast/comment.ts";
import { type Child, isElement } from "../ast/element.ts";
import { isProcessingInstruction } from "../ast/processing-instruction.ts";
import { CData, isCData, isText, Text } from "../ast/text.ts";
import type { DecodeState } from "./context.ts";
import { failIssues } from "./issue.ts";

/** Recognizes an XML child without recursively validating its descendants. */
export const isOrderedChild = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the ordered XML child recognition boundary.
  input: unknown,
): input is Child =>
  isText(input) ||
  isCData(input) ||
  isComment(input) ||
  isProcessingInstruction(input) ||
  isElement(input);

const mergedText = (first: Text, value: string) =>
  first.span === undefined ? new Text({ value }) : new Text({ value, span: first.span });

const mergedCData = (first: CData, value: string) =>
  first.span === undefined ? new CData({ value }) : new CData({ value, span: first.span });

/** Canonicalizes adjacent ordinary Text and adjacent CData as separate node-kind runs. */
export const canonicalizeOrderedChildren = (
  children: ReadonlyArray<Child>,
  state?: DecodeState,
): ReadonlyArray<Child> => {
  let output: Array<Child> | undefined;

  for (let index = 1; index < children.length; index++) {
    const previous = children[index - 1]!;
    const child = children[index]!;
    if ((isText(previous) && isText(child)) || (isCData(previous) && isCData(child))) {
      output = children.slice(0, index);
      break;
    }
  }
  if (output === undefined) return children;

  for (let index = output.length; index < children.length; index++) {
    const child = children[index]!;
    const previous = output[output.length - 1];
    if (previous !== undefined && isText(previous) && isText(child)) {
      const merged = mergedText(previous, previous.value + child.value);
      const location = state?.positions.get(previous) ?? state?.positions.get(child);
      if (location !== undefined) state?.positions.set(merged, location);
      output[output.length - 1] = merged;
    } else if (previous !== undefined && isCData(previous) && isCData(child)) {
      const merged = mergedCData(previous, previous.value + child.value);
      const location = state?.positions.get(previous) ?? state?.positions.get(child);
      if (location !== undefined) state?.positions.set(merged, location);
      output[output.length - 1] = merged;
    } else {
      output.push(child);
    }
  }
  return output;
};

/** Rejects typed node boundaries that XML parsing cannot recover after serialization. */
export const validateOrderedChildren = (
  children: ReadonlyArray<Child>,
  ast: SchemaAST.AST,
  options: SchemaAST.ParseOptions,
) => {
  const issues: Array<SchemaIssue.Issue> = [];
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    let message: string | undefined;
    if (isText(child) && child.value.length === 0) {
      message = "An empty ordered XML Text item has no recoverable parsed representation";
    } else if (index > 0 && isText(child) && isText(children[index - 1])) {
      message = "Adjacent ordered XML Text items have no recoverable parsed boundary";
    } else if (index > 0 && isCData(child) && isCData(children[index - 1])) {
      message = "Adjacent ordered XML CData items have no recoverable parsed boundary";
    }
    if (message !== undefined) {
      issues.push(
        new SchemaIssue.Pointer([index], new SchemaIssue.InvalidValue({ message }, child, options)),
      );
    }
  }
  return issues.length === 0
    ? Effect.succeed(children)
    : failIssues(ast, issues, children, options);
};
