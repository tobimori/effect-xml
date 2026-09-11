import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import {
  isProcessingInstruction,
  ProcessingInstruction as ProcessingInstructionNode,
} from "../ast/processing-instruction.ts";
import { isNcName } from "../parser/character.ts";
import { encoded } from "./metadata.ts";
import { scalar, validateXmlCharacters } from "./scalar.ts";

const validTarget = (target: string) => isNcName(target) && target.toLowerCase() !== "xml";

const targetIssue = <Input>(target: string, input: Input, options: SchemaAST.ParseOptions) =>
  new SchemaIssue.InvalidValue(
    { message: `Expected XML processing instruction target ${JSON.stringify(target)}` },
    input,
    options,
  );

/** Places one scalar value in one fixed-target XML processing instruction. */
export const ProcessingInstruction = <S extends Schema.Constraint>(
  target: string,
  schema: S,
): Schema.Codec<
  S["Type"],
  ProcessingInstructionNode,
  S["DecodingServices"],
  S["EncodingServices"]
> =>
  encoded(
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the PI-node boundary.
    (input): input is ProcessingInstructionNode => isProcessingInstruction(input),
    { kind: "processing-instruction", target },
  ).pipe(
    Schema.decodeTo(
      scalar(schema),
      SchemaTransformation.transformEffect<string, ProcessingInstructionNode>({
        decode: (instruction, options) =>
          instruction.target === target && validTarget(target)
            ? Effect.succeed(instruction.value)
            : Effect.fail(targetIssue(target, instruction, options)),
        encode: (value, options) => {
          if (!validTarget(target)) return Effect.fail(targetIssue(target, value, options));
          if (value.includes("?>")) {
            return Effect.fail(
              new SchemaIssue.InvalidValue(
                { message: "XML processing instruction data must not contain '?>'" },
                value,
                options,
              ),
            );
          }
          return Effect.map(
            validateXmlCharacters(value, "XML processing instruction data", options),
            (valid) => new ProcessingInstructionNode({ target, value: valid }),
          );
        },
      }),
    ),
  );
