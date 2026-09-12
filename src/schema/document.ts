import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { Declaration } from "../ast/declaration.ts";
import { Document as AstDocument } from "../ast/document.ts";
import { isElement } from "../ast/element.ts";
import { CurrentEncodeState } from "./context.ts";
import { delegateRequired } from "./delegate.ts";
import {
  documentNodeWithinDocument,
  type DocumentNodeOptions,
  withDocumentDecodeState,
} from "./document-node.ts";
import type { DocumentRoot } from "./metadata.ts";

export interface DeclarationOptions {
  readonly version: "1.0" | "1.1";
  readonly encoding?: string;
  readonly standalone?: "yes" | "no";
}

export interface DocumentOptions extends DocumentNodeOptions {
  readonly sortKeys?: boolean;
  readonly declaration?: DeclarationOptions;
}

const invalidOptions = <Input>(
  message: string,
  input: Input,
  options: import("effect/SchemaAST").ParseOptions,
) => Effect.fail(new SchemaIssue.InvalidValue({ message }, input, options));

const declarationFromOptions = (
  documentOptions: DocumentOptions,
  parseOptions: import("effect/SchemaAST").ParseOptions,
) => {
  const input: unknown = documentOptions;
  if (!Predicate.isObject(input)) {
    return invalidOptions("XML document options must be an object", input, parseOptions);
  }
  const declaration = Predicate.hasProperty(input, "declaration") ? input.declaration : undefined;
  if (declaration === undefined) return Effect.void;
  if (!Predicate.isObject(declaration)) {
    return invalidOptions("XML declaration options must be an object", declaration, parseOptions);
  }

  const version = Predicate.hasProperty(declaration, "version") ? declaration.version : undefined;
  if (version !== "1.0" && version !== "1.1") {
    return invalidOptions('XML declaration version must be "1.0" or "1.1"', version, parseOptions);
  }
  const encoding = Predicate.hasProperty(declaration, "encoding")
    ? declaration.encoding
    : undefined;
  if (encoding !== undefined && !Predicate.isString(encoding)) {
    return invalidOptions("XML declaration encoding must be a string", encoding, parseOptions);
  }
  const standalone = Predicate.hasProperty(declaration, "standalone")
    ? declaration.standalone
    : undefined;
  if (standalone !== undefined && standalone !== "yes" && standalone !== "no") {
    return invalidOptions(
      'XML declaration standalone must be "yes" or "no"',
      standalone,
      parseOptions,
    );
  }

  if (encoding === undefined) {
    return Effect.succeed(
      standalone === undefined
        ? new Declaration({ version })
        : new Declaration({ version, standalone }),
    );
  }
  return Effect.succeed(
    standalone === undefined
      ? new Declaration({ version, encoding })
      : new Declaration({ version, encoding, standalone }),
  );
};

const documentVersion = (options: DocumentOptions) => {
  const input: unknown = options;
  if (!Predicate.isObject(input) || !Predicate.hasProperty(input, "declaration")) return "1.0";
  const declaration = input.declaration;
  return Predicate.isObject(declaration) &&
    Predicate.hasProperty(declaration, "version") &&
    declaration.version === "1.1"
    ? "1.1"
    : "1.0";
};

/** Maps one typed root element to a complete XML document string. */
export const Document = <S extends DocumentRoot>(
  root: S,
  options: DocumentOptions = {},
): Schema.Codec<S["Type"], string, S["DecodingServices"], S["EncodingServices"]> => {
  const codec = documentNodeWithinDocument(options).pipe(
    Schema.decodeTo(
      root,
      SchemaTransformation.transformEffect({
        decode: (document) => Effect.succeed(document.root),
        encode: (element, parseOptions) => {
          if (!isElement(element)) {
            return Effect.fail(
              new SchemaIssue.InvalidValue(
                { message: "Expected one encoded XML document root element" },
                element,
                parseOptions,
              ),
            );
          }
          const fields = { prolog: [], root: element, epilog: [] };
          return Effect.mapEager(declarationFromOptions(options, parseOptions), (declaration) =>
            declaration === undefined
              ? new AstDocument(fields)
              : new AstDocument({ ...fields, declaration }),
          );
        },
      }),
    ),
  );

  return delegateRequired(
    codec,
    (effect) => withDocumentDecodeState(effect, true),
    (effect, parseOptions) =>
      Effect.suspend(() =>
        Effect.flatMapEager(declarationFromOptions(options, parseOptions), () =>
          Effect.provideService(effect, CurrentEncodeState, {
            structured: new WeakSet(),
            typed: new WeakSet(),
            sortKeys:
              !Predicate.isObject(options) ||
              !Predicate.hasProperty(options, "sortKeys") ||
              options.sortKeys !== false,
            version: documentVersion(options),
          }),
        ),
      ),
  );
};
