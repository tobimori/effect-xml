import * as Effect from "effect/Effect";
import type * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";

/** Fails with one issue or an Effect composite according to the active error mode. */
export const failIssues = <Input>(
  ast: SchemaAST.AST,
  issues: ReadonlyArray<SchemaIssue.Issue>,
  input: Input,
  options: SchemaAST.ParseOptions,
) => {
  const selected = options.errors === "all" ? issues : issues.slice(0, 1);
  return selected.length === 1
    ? Effect.fail(selected[0]!)
    : Effect.fail(
        new SchemaIssue.Composite(
          ast,
          // SAFETY: This branch is reached only when selected contains at least two issues.
          selected as readonly [SchemaIssue.Issue, ...Array<SchemaIssue.Issue>],
          input,
          options,
        ),
      );
};
