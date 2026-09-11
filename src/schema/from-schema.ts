import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import type { Element as ElementNode } from "../ast/element.ts";
import { isNcName } from "../parser/character.ts";
import { Array as XmlArray } from "./array.ts";
import { delegate } from "./delegate.ts";
import { Document, type DocumentOptions } from "./document.ts";
import { Element } from "./element.ts";
import type { StructField } from "./metadata.ts";
import { adaptSchema } from "./schema-adapter.ts";
import { lazy } from "./lazy.ts";
import { Struct } from "./struct.ts";
import { suspend } from "./suspend.ts";

export interface FromSchemaOptions extends DocumentOptions {
  readonly rootName?: string;
}

type ElementCodec = Schema.Codec<unknown, ElementNode, unknown, unknown>;

type FailureRun = ConstructorParameters<typeof SchemaAST.Declaration>[1];

const invalidRun: (message: string) => FailureRun = (message) => () => (input, _self, options) =>
  Effect.fail(new SchemaIssue.InvalidValue({ message }, input, options));

const invalidCodec = <S extends Schema.Constraint>(
  message: string,
): Schema.Codec<S["Type"], string, S["DecodingServices"], S["EncodingServices"]> => {
  const run = invalidRun(message);
  return Schema.make(
    new SchemaAST.Declaration([], run, undefined, undefined, undefined, undefined, undefined, run),
  ) as Schema.Codec<S["Type"], string, S["DecodingServices"], S["EncodingServices"]>;
};

const eraseElementType = <A, RD, RE>(codec: Schema.Codec<A, ElementNode, RD, RE>): ElementCodec => {
  return codec as ElementCodec;
};

const invalidElement = (name: string, message: string) => {
  const failed = Schema.String.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformEffect<string, string>({
        decode: (input, options) =>
          Effect.fail(new SchemaIssue.InvalidValue({ message }, input, options)),
        encode: (input, options) =>
          Effect.fail(new SchemaIssue.InvalidValue({ message }, input, options)),
      }),
    ),
  );
  return eraseElementType(Element(name, failed));
};

const finalEncodedAst = (root: SchemaAST.AST) => {
  const seen = new Set<SchemaAST.AST>();
  let ast = root;
  while (ast.encoding !== undefined) {
    if (seen.has(ast)) return undefined;
    seen.add(ast);
    ast = ast.encoding.at(-1)!.to;
  }
  return ast;
};

const substantiveUnionMembers = (ast: SchemaAST.Union) =>
  ast.types.filter((member) => !SchemaAST.isUndefined(member));

interface Inspection {
  readonly unsupported?: string;
  readonly suspendTargets: Map<SchemaAST.Suspend, SchemaAST.AST>;
}

/** Inspects every eager edge and each distinct public Suspend thunk iteratively. */
const inspect = (root: SchemaAST.AST): Inspection => {
  const suspendTargets = new Map<SchemaAST.Suspend, SchemaAST.AST>();
  const discovered = new Set<SchemaAST.AST>();
  const work: Array<SchemaAST.AST> = [root];

  while (work.length > 0) {
    const ast = work.pop()!;
    if (discovered.has(ast)) continue;
    discovered.add(ast);

    if (SchemaAST.isUnion(ast) && substantiveUnionMembers(ast).length > 1) {
      return {
        unsupported: "Xml.fromSchema does not support ambiguous unions",
        suspendTargets,
      };
    }
    if (SchemaAST.isArrays(ast) && (ast.elements.length !== 0 || ast.rest.length !== 1)) {
      return {
        unsupported: "Xml.fromSchema supports homogeneous Arrays, not Tuples",
        suspendTargets,
      };
    }
    if (SchemaAST.isObjects(ast) && ast.indexSignatures.length > 0) {
      return {
        unsupported: "Xml.fromSchema does not support records or index signatures",
        suspendTargets,
      };
    }
    if (ast.encoding !== undefined) {
      for (const link of ast.encoding) work.push(link.to);
    }
    if (SchemaAST.isArrays(ast)) {
      work.push(...ast.elements, ...ast.rest);
    } else if (SchemaAST.isObjects(ast)) {
      for (const property of ast.propertySignatures) work.push(property.type);
      for (const index of ast.indexSignatures) work.push(index.parameter, index.type);
    } else if (SchemaAST.isUnion(ast)) {
      work.push(...ast.types);
    } else if (SchemaAST.isDeclaration(ast)) {
      work.push(...ast.typeParameters);
    } else if (SchemaAST.isSuspend(ast)) {
      const target = ast.thunk();
      suspendTargets.set(ast, target);
      work.push(target);
    }
  }

  return { suspendTargets };
};

interface EncodedInspection {
  readonly unsupported?: string;
}

const isSupportedLiteral = (ast: SchemaAST.AST): ast is SchemaAST.Literal =>
  SchemaAST.isLiteral(ast) &&
  (Predicate.isString(ast.literal) ||
    Predicate.isNumber(ast.literal) ||
    Predicate.isBoolean(ast.literal) ||
    Predicate.isBigInt(ast.literal));

const inspectEncodedRepresentation = (
  root: SchemaAST.AST,
  suspendTargets: ReadonlyMap<SchemaAST.Suspend, SchemaAST.AST>,
): EncodedInspection => {
  const discovered = new Set<SchemaAST.AST>();
  const work: Array<SchemaAST.AST> = [root];

  while (work.length > 0) {
    let ast = finalEncodedAst(work.pop()!);
    if (ast === undefined) return { unsupported: "Xml.fromSchema found a cyclic encoding chain" };

    if (SchemaAST.isUnion(ast)) {
      const members = substantiveUnionMembers(ast);
      if (members.length !== 1) {
        return { unsupported: "Xml.fromSchema requires one reversible encoded union member" };
      }
      ast = finalEncodedAst(members[0]!);
      if (ast === undefined) return { unsupported: "Xml.fromSchema found a cyclic encoding chain" };
    }
    if (discovered.has(ast)) continue;
    discovered.add(ast);

    if (
      SchemaAST.isString(ast) ||
      SchemaAST.isNumber(ast) ||
      SchemaAST.isBoolean(ast) ||
      SchemaAST.isBigInt(ast) ||
      isSupportedLiteral(ast)
    ) {
      continue;
    }
    if (SchemaAST.isSuspend(ast)) {
      const target = suspendTargets.get(ast);
      if (target === undefined)
        return { unsupported: "Xml.fromSchema could not resolve a suspension" };
      work.push(target);
      continue;
    }
    if (SchemaAST.isObjects(ast)) {
      if (ast.indexSignatures.length > 0) {
        return { unsupported: "Xml.fromSchema does not support records or index signatures" };
      }
      for (const property of ast.propertySignatures) {
        if (!Predicate.isString(property.name)) {
          return { unsupported: "Xml.fromSchema requires string Struct property keys" };
        }
        if (!isNcName(property.name)) {
          return {
            unsupported: `Xml.fromSchema Struct key ${JSON.stringify(property.name)} is not an XML NCName`,
          };
        }
        work.push(property.type);
      }
      continue;
    }
    if (SchemaAST.isArrays(ast)) {
      if (ast.elements.length !== 0 || ast.rest.length !== 1) {
        return { unsupported: "Xml.fromSchema supports homogeneous Arrays, not Tuples" };
      }
      work.push(ast.rest[0]!);
      continue;
    }
    return {
      unsupported: "Xml.fromSchema does not support this encoded schema",
    };
  }

  return {};
};

const encodedOptional = (root: SchemaAST.AST) => {
  const ast = finalEncodedAst(root);
  if (ast === undefined) return false;
  if (ast.context?.isOptional === true) return true;
  return SchemaAST.isUnion(ast) && ast.types.some(SchemaAST.isUndefined);
};

interface DeriveFrame {
  readonly ast: SchemaAST.AST;
  readonly name: string;
  readonly exit: boolean;
}

type DerivationCache = Map<SchemaAST.AST, Map<string, ElementCodec>>;

const orderedProperties = (ast: SchemaAST.Objects, sortKeys: boolean) =>
  sortKeys
    ? [...ast.propertySignatures].sort((left, right) => {
        const leftKey = String(left.name);
        const rightKey = String(right.name);
        if (leftKey < rightKey) return -1;
        if (leftKey > rightKey) return 1;
        return 0;
      })
    : ast.propertySignatures;

const deriveElements = (
  root: SchemaAST.AST,
  rootName: string,
  suspendTargets: ReadonlyMap<SchemaAST.Suspend, SchemaAST.AST>,
  sortKeys: boolean,
  cache: DerivationCache = new Map(),
): ElementCodec => {
  const getCached = (ast: SchemaAST.AST, name: string) => cache.get(ast)?.get(name);
  const putCached = (ast: SchemaAST.AST, name: string, codec: ElementCodec) => {
    let names = cache.get(ast);
    if (names === undefined) {
      names = new Map();
      cache.set(ast, names);
    }
    names.set(name, codec);
  };
  const normalize = (input: SchemaAST.AST) => {
    let ast = finalEncodedAst(input)!;
    while (SchemaAST.isUnion(ast)) {
      ast = finalEncodedAst(substantiveUnionMembers(ast)[0]!)!;
    }
    return ast;
  };

  const stack: Array<DeriveFrame> = [{ ast: normalize(root), name: rootName, exit: false }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    const ast = normalize(frame.ast);
    if (getCached(ast, frame.name) !== undefined) continue;

    if (!frame.exit) {
      if (SchemaAST.isSuspend(ast)) {
        const target = suspendTargets.get(ast)!;
        const codec = suspend(() => {
          try {
            return deriveElements(target, frame.name, suspendTargets, sortKeys, cache);
          } catch (error) {
            const detail = error instanceof globalThis.Error ? `: ${error.message}` : "";
            return invalidElement(
              frame.name,
              `Xml.fromSchema cannot derive this suspension${detail}`,
            );
          }
        });
        putCached(ast, frame.name, codec);
        continue;
      }
      stack.push({ ...frame, ast, exit: true });
      if (SchemaAST.isObjects(ast)) {
        const properties = orderedProperties(ast, sortKeys);
        for (let index = properties.length - 1; index >= 0; index--) {
          const property = properties[index]!;
          stack.push({ ast: normalize(property.type), name: String(property.name), exit: false });
        }
      } else if (SchemaAST.isArrays(ast)) {
        stack.push({ ast: normalize(ast.rest[0]!), name: "item", exit: false });
      }
      continue;
    }

    let codec: ElementCodec;
    if (SchemaAST.isString(ast)) {
      codec = eraseElementType(Element(frame.name, Schema.String));
    } else if (SchemaAST.isNumber(ast)) {
      codec = eraseElementType(Element(frame.name, Schema.Number));
    } else if (SchemaAST.isBoolean(ast)) {
      codec = eraseElementType(Element(frame.name, Schema.Boolean));
    } else if (SchemaAST.isBigInt(ast)) {
      codec = eraseElementType(Element(frame.name, Schema.BigInt));
    } else if (isSupportedLiteral(ast)) {
      codec = eraseElementType(
        Element(frame.name, Schema.make(new SchemaAST.Literal(ast.literal))),
      );
    } else if (SchemaAST.isArrays(ast)) {
      const itemAst = normalize(ast.rest[0]!);
      const item = getCached(itemAst, "item")!;
      codec = eraseElementType(Element(frame.name, XmlArray(item)));
    } else if (SchemaAST.isObjects(ast)) {
      const fields: Record<string, StructField> = Object.create(null);
      const properties = orderedProperties(ast, sortKeys);
      for (const property of properties) {
        const name = String(property.name);
        const field = getCached(normalize(property.type), name)!;
        fields[name] = encodedOptional(property.type) ? Schema.optionalKey(field) : field;
      }
      codec = eraseElementType(Element(frame.name, Struct(fields)));
    } else {
      codec = invalidElement(frame.name, "Xml.fromSchema does not support this encoded schema");
    }
    putCached(ast, frame.name, codec);
  }

  return getCached(normalize(root), rootName)!;
};

const optionRootName = (options: FromSchemaOptions) => {
  const input: unknown = options;
  if (!Predicate.isObject(input) || !Predicate.hasProperty(input, "rootName")) return undefined;
  return Predicate.isString(input.rootName) ? input.rootName : undefined;
};

/**
 * Derives the reversible convention mapping for scalar leaves, Structs,
 * homogeneous Arrays, optional/default keys, and suspended combinations of
 * those forms. Unsupported shapes fail with InvalidValue when the codec runs.
 */
const buildFromSchema = <S extends Schema.Constraint>(
  schema: S,
  options: FromSchemaOptions,
): Schema.Codec<S["Type"], string, S["DecodingServices"], S["EncodingServices"]> => {
  try {
    const input: unknown = options;
    if (
      Predicate.isObject(input) &&
      Predicate.hasProperty(input, "rootName") &&
      input.rootName !== undefined &&
      !Predicate.isString(input.rootName)
    ) {
      return invalidCodec<S>("Xml.fromSchema rootName must be a string");
    }

    const inspection = inspect(schema.ast);
    if (inspection.unsupported !== undefined) return invalidCodec<S>(inspection.unsupported);
    const representation = inspectEncodedRepresentation(schema.ast, inspection.suspendTargets);
    if (representation.unsupported !== undefined) {
      return invalidCodec<S>(representation.unsupported);
    }

    const annotatedIdentifier = schema.ast.annotations?.["identifier"];
    const annotatedTitle = schema.ast.annotations?.["title"];
    const rootName =
      optionRootName(options) ??
      (Predicate.isString(annotatedIdentifier) ? annotatedIdentifier : undefined) ??
      SchemaAST.resolveIdentifier(schema.ast) ??
      (Predicate.isString(annotatedTitle) ? annotatedTitle : undefined) ??
      SchemaAST.resolveTitle(schema.ast) ??
      "root";
    if (!isNcName(rootName)) {
      return invalidCodec<S>(
        `Xml.fromSchema root name ${JSON.stringify(rootName)} is not an XML NCName`,
      );
    }
    const sortKeys =
      !Predicate.isObject(options) ||
      !Predicate.hasProperty(options, "sortKeys") ||
      options.sortKeys !== false;
    const projected = deriveElements(
      schema.ast,
      rootName,
      inspection.suspendTargets,
      sortKeys,
    ) as Schema.Codec<S["Encoded"], ElementNode>;
    const adapted = delegate(
      adaptSchema(schema),
      (effect) => effect,
      (effect) => effect,
    );
    // Keep validation inside the XML scope. Delegation gives shared failure leaves
    // separate document roots without running application checks again
    return Document(
      projected.pipe(Schema.decodeTo(adapted, SchemaTransformation.passthrough())),
      options,
    ) as Schema.Codec<S["Type"], string, S["DecodingServices"], S["EncodingServices"]>;
  } catch (error) {
    const detail = error instanceof globalThis.Error ? `: ${error.message}` : "";
    return invalidCodec<S>(`Xml.fromSchema could not derive this schema${detail}`);
  }
};

/**
 * Derives the reversible convention mapping for scalar leaves, Structs,
 * homogeneous Arrays, optional/default keys, and suspended combinations of
 * those forms. Construction is lazy; unsupported shapes and invalid options
 * fail with InvalidValue when decoding or encoding executes.
 */
export const fromSchema = <S extends Schema.Constraint>(
  schema: S,
  options: FromSchemaOptions = {},
): Schema.Codec<S["Type"], string, S["DecodingServices"], S["EncodingServices"]> =>
  lazy(() => buildFromSchema(schema, options));
