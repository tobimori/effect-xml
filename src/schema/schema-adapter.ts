import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HashSet from "effect/HashSet";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaParser from "effect/SchemaParser";

interface IdentityTable {
  readonly ids: WeakMap<object, number>;
  next: number;
}

interface ParsePath {
  readonly identities: IdentityTable;
  readonly active: HashSet.HashSet<number>;
}

const CurrentParsePath = Context.Reference<ParsePath | undefined>(
  "effect-xml/from-schema/parse-path",
  { defaultValue: () => undefined },
);

type DeclarationRun = ConstructorParameters<typeof SchemaAST.Declaration>[1];

/**
 * Delegates one local Objects or Arrays parser while tracking only the object
 * identity consumed by that parser. Encoding links remain on the surrounding
 * declaration while checks remain on the local product, so transformations and
 * checks retain their normal order and execute exactly once.
 */
const guardedRun: DeclarationRun = (typeParameters) => {
  const codec = Schema.make(typeParameters[0]!);
  const parse = SchemaParser.decodeUnknownEffect(codec) as (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Schema parser boundary accepts unknown input.
    input: unknown,
    options?: SchemaAST.ParseOptions,
  ) => Effect.Effect<unknown, SchemaIssue.Issue>;

  return (input, _self, options) =>
    Effect.flatMap(CurrentParsePath, (inherited) => {
      if (!Predicate.isObject(input)) return Effect.suspend(() => parse(input, options));

      const path: ParsePath = inherited ?? {
        identities: { ids: new WeakMap(), next: 0 },
        active: HashSet.empty(),
      };
      let identity = path.identities.ids.get(input);
      if (identity === undefined) {
        identity = path.identities.next++;
        path.identities.ids.set(input, identity);
      }
      if (HashSet.has(path.active, identity)) {
        return Effect.fail(
          new SchemaIssue.InvalidValue({ message: "Cyclic schema value" }, input, options),
        );
      }
      return Effect.provideService(
        Effect.suspend(() => parse(input, options)),
        CurrentParsePath,
        {
          identities: path.identities,
          active: HashSet.add(path.active, identity),
        },
      );
    });
};

interface Frame {
  readonly ast: SchemaAST.AST;
  readonly exit: boolean;
}

interface AdapterState {
  readonly rebuilt: Map<SchemaAST.AST, SchemaAST.AST>;
  readonly pending: Set<SchemaAST.AST>;
}

const childAsts = (ast: SchemaAST.AST) => {
  const children: Array<SchemaAST.AST> = [];
  if (ast.encoding !== undefined) {
    for (const link of ast.encoding) children.push(link.to);
  }
  if (SchemaAST.isArrays(ast)) {
    children.push(...ast.elements, ...ast.rest);
  } else if (SchemaAST.isObjects(ast)) {
    for (const property of ast.propertySignatures) children.push(property.type);
    for (const index of ast.indexSignatures) children.push(index.parameter, index.type);
  } else if (SchemaAST.isUnion(ast)) {
    children.push(...ast.types);
  } else if (SchemaAST.isDeclaration(ast)) {
    children.push(...ast.typeParameters);
  }
  // Suspend remains lazy. Its thunk shares this adapter's memo table when run.
  return children;
};

const rebuildLeaf = (
  ast: Exclude<
    SchemaAST.AST,
    | SchemaAST.Arrays
    | SchemaAST.Objects
    | SchemaAST.Union
    | SchemaAST.Declaration
    | SchemaAST.Suspend
  >,
  encoding: SchemaAST.Encoding,
) => {
  const args = [ast.annotations, ast.checks, encoding, ast.context] as const;
  if (SchemaAST.isLiteral(ast)) return new SchemaAST.Literal(ast.literal, ...args);
  if (SchemaAST.isUniqueSymbol(ast)) return new SchemaAST.UniqueSymbol(ast.symbol, ...args);
  if (SchemaAST.isEnum(ast)) return new SchemaAST.Enum(ast.enums, ...args);
  if (SchemaAST.isTemplateLiteral(ast)) return new SchemaAST.TemplateLiteral(ast.parts, ...args);
  if (SchemaAST.isNull(ast)) return new SchemaAST.Null(...args);
  if (SchemaAST.isUndefined(ast)) return new SchemaAST.Undefined(...args);
  if (SchemaAST.isVoid(ast)) return new SchemaAST.Void(...args);
  if (SchemaAST.isNever(ast)) return new SchemaAST.Never(...args);
  if (SchemaAST.isUnknown(ast)) return new SchemaAST.Unknown(...args);
  if (SchemaAST.isAny(ast)) return new SchemaAST.Any(...args);
  if (SchemaAST.isString(ast)) return new SchemaAST.String(...args);
  if (SchemaAST.isNumber(ast)) return new SchemaAST.Number(...args);
  if (SchemaAST.isBoolean(ast)) return new SchemaAST.Boolean(...args);
  if (SchemaAST.isBigInt(ast)) return new SchemaAST.BigInt(...args);
  if (SchemaAST.isSymbol(ast)) return new SchemaAST.Symbol(...args);
  return new SchemaAST.ObjectKeyword(...args);
};

const adaptAstWithState = (root: SchemaAST.AST, state: AdapterState): SchemaAST.AST => {
  const existing = state.rebuilt.get(root);
  if (existing !== undefined) return existing;

  const stack: Array<Frame> = [{ ast: root, exit: false }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    const ast = frame.ast;
    if (state.rebuilt.has(ast)) continue;

    if (!frame.exit) {
      if (state.pending.has(ast)) {
        throw new Error("Unexpected direct cycle outside SchemaAST.Suspend");
      }
      state.pending.add(ast);
      stack.push({ ast, exit: true });
      const children = childAsts(ast);
      for (let index = children.length - 1; index >= 0; index--) {
        const child = children[index]!;
        if (!state.rebuilt.has(child)) stack.push({ ast: child, exit: false });
      }
      continue;
    }

    const get = (child: SchemaAST.AST) => state.rebuilt.get(child)!;
    const encoding = ast.encoding?.map(
      (link) => new SchemaAST.Link(get(link.to), link.transformation),
    ) as SchemaAST.Encoding | undefined;
    let output: SchemaAST.AST;

    if (SchemaAST.isSuspend(ast)) {
      // Product boundaries already yield before recursive data descent. Keeping
      // Suspend visible also preserves Effect's union candidate discovery.
      output = new SchemaAST.Suspend(
        () => adaptAstWithState(ast.thunk(), state),
        ast.annotations,
        undefined,
        encoding,
        ast.context,
      );
    } else if (SchemaAST.isArrays(ast) || SchemaAST.isObjects(ast)) {
      const local = SchemaAST.isArrays(ast)
        ? new SchemaAST.Arrays(
            ast.isMutable,
            ast.elements.map(get),
            ast.rest.map(get),
            ast.annotations,
            ast.checks,
            undefined,
            undefined,
            ast.encodingChecks,
          )
        : new SchemaAST.Objects(
            ast.propertySignatures.map(
              (property) => new SchemaAST.PropertySignature(property.name, get(property.type)),
            ),
            ast.indexSignatures.map(
              (index) => new SchemaAST.IndexSignature(get(index.parameter), get(index.type)),
            ),
            ast.annotations,
            ast.checks,
            undefined,
            undefined,
            ast.encodingChecks,
          );
      output = new SchemaAST.Declaration(
        [new SchemaAST.Suspend(() => local)],
        guardedRun,
        ast.annotations,
        undefined,
        encoding,
        ast.context,
        undefined,
        guardedRun,
      );
    } else if (SchemaAST.isUnion(ast)) {
      // The supported subset permits at most one non-Undefined member, so no
      // competing candidate can be selected or skipped at this boundary.
      output = new SchemaAST.Union(
        ast.types.map(get),
        ast.options,
        ast.annotations,
        ast.checks,
        encoding,
        ast.context,
        ast.encodingChecks,
      );
    } else if (SchemaAST.isDeclaration(ast)) {
      output = new SchemaAST.Declaration(
        ast.typeParameters.map(get),
        ast.run,
        ast.annotations,
        ast.checks,
        encoding,
        ast.context,
        ast.encodingChecks,
        ast.encodingRun,
      );
    } else {
      output = encoding === undefined ? ast : rebuildLeaf(ast, encoding);
    }

    state.rebuilt.set(ast, output);
    state.pending.delete(ast);
  }

  return state.rebuilt.get(root)!;
};

/**
 * Rebuilds the AST subset accepted by Xml.fromSchema iteratively. Objects and
 * Arrays receive suspended parser boundaries and path-local cycle guards.
 * The caller must first inspect every eager edge and memoized Suspend target
 * and reject ambiguous unions. Ordinary declarations, transformations, checks,
 * defaults, context, and parse options remain owned by Effect.
 */
export const adaptInspectedSchema = <S extends Schema.Constraint>(
  schema: S,
): Schema.Codec<S["Type"], S["Encoded"], S["DecodingServices"], S["EncodingServices"]> => {
  const state: AdapterState = { rebuilt: new Map(), pending: new Set() };
  return Schema.make(adaptAstWithState(schema.ast, state));
};
