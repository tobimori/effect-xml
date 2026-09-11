import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaParser from "effect/SchemaParser";
import * as SchemaTransformation from "effect/SchemaTransformation";

import * as Xml from "../src/xml.ts";

describe("fromSchema supported conventions", () => {
  it("encodes and decodes a String scalar", () => {
    const codec = Xml.fromSchema(Schema.String, {
      rootName: "value",
      pretty: false,
    });
    const xml = "<value>hello</value>";

    expect(Schema.encodeSync(codec)("hello")).toBe(xml);
    expect(Schema.decodeSync(codec)(xml)).toBe("hello");
  });

  it("encodes and decodes a Number scalar", () => {
    const codec = Xml.fromSchema(Schema.Number, {
      rootName: "value",
      pretty: false,
    });
    const xml = "<value>1.5</value>";

    expect(Schema.encodeSync(codec)(1.5)).toBe(xml);
    expect(Schema.decodeSync(codec)(xml)).toBe(1.5);
  });

  it("encodes and decodes a Boolean scalar", () => {
    const codec = Xml.fromSchema(Schema.Boolean, {
      rootName: "value",
      pretty: false,
    });
    const xml = "<value>true</value>";

    expect(Schema.encodeSync(codec)(true)).toBe(xml);
    expect(Schema.decodeSync(codec)(xml)).toBe(true);
  });

  it("encodes and decodes a BigInt scalar", () => {
    const codec = Xml.fromSchema(Schema.BigInt, {
      rootName: "value",
      pretty: false,
    });
    const xml = "<value>12</value>";

    expect(Schema.encodeSync(codec)(12n)).toBe(xml);
    expect(Schema.decodeSync(codec)(xml)).toBe(12n);
  });

  it("maps nested Struct and Array values to named elements", () => {
    const item = Schema.Struct({
      id: Schema.Int,
      active: Schema.Boolean,
    });

    const source = Schema.Struct({
      title: Schema.String,
      items: Schema.Array(item),
    });

    const codec = Xml.fromSchema(source, {
      rootName: "feed",
      pretty: false,
    });

    const value = {
      title: "Example",
      items: [
        { id: 1, active: true },
        { id: 2, active: false },
      ],
    };

    const xml =
      "<feed>" +
      "<items>" +
      "<item><active>true</active><id>1</id></item>" +
      "<item><active>false</active><id>2</id></item>" +
      "</items>" +
      "<title>Example</title>" +
      "</feed>";

    const encoded = Schema.encodeSync(codec)(value);
    const decoded = Schema.decodeSync(codec)(xml);

    expect(encoded).toBe(xml);
    expect(decoded).toEqual(value);
  });

  it("preserves optional absence and applies an omitted decoding default once", () => {
    let defaults = 0;
    const source = Schema.Struct({
      optional: Schema.optionalKey(Schema.String),
      defaulted: Schema.String.pipe(
        Schema.withDecodingDefaultKey(
          Effect.sync(() => {
            defaults++;
            return "fallback";
          }),
          { encodingStrategy: "omit" },
        ),
      ),
    });
    const codec = Xml.fromSchema(source, { pretty: false });

    const decoded = Schema.decodeSync(codec)("<root/>");

    expect(decoded).toEqual({ defaulted: "fallback" });
    expect(Object.hasOwn(decoded, "optional")).toBe(false);
    expect(defaults).toBe(1);
    expect(Schema.encodeSync(codec)(decoded)).toBe("<root/>");
    expect(defaults).toBe(1);
  });

  it("defers a supported Suspend and retains its recursive XML convention", () => {
    interface Branch {
      readonly value: string;
      readonly children: ReadonlyArray<Branch>;
    }
    let forces = 0;
    const branchRef = Schema.suspend((): Schema.Codec<Branch> => {
      forces++;
      return branch;
    });
    const branch: Schema.Codec<Branch> = Schema.Struct({
      value: Schema.String,
      children: Schema.Array(branchRef),
    });
    const codec = Xml.fromSchema(branch, { rootName: "tree", pretty: false });
    const value: Branch = {
      value: "root",
      children: [{ value: "leaf", children: [] }],
    };
    const xml =
      "<tree><children><item><children/><value>leaf</value></item></children><value>root</value></tree>";

    expect(forces).toBe(0);
    expect(Schema.encodeSync(codec)(value)).toBe(xml);
    expect(forces).toBe(1);
    expect(Schema.decodeSync(codec)(xml)).toEqual(value);
  });

  it("prefers an explicit root name over schema annotations", () => {
    const source = Schema.String.annotate({
      identifier: "identifier",
      title: "title",
    });
    const codec = Xml.fromSchema(source, {
      rootName: "explicit",
      pretty: false,
    });
    const xml = "<explicit>x</explicit>";

    expect(Schema.encodeSync(codec)("x")).toBe(xml);
    expect(Schema.decodeSync(codec)(xml)).toBe("x");
  });

  it("prefers an identifier annotation over a title annotation", () => {
    const identified = Schema.String.annotate({
      identifier: "identifier",
      title: "title",
    });
    const identifiedCodec = Xml.fromSchema(identified, { pretty: false });
    const identifiedXml = "<identifier>x</identifier>";

    expect(Schema.encodeSync(identifiedCodec)("x")).toBe(identifiedXml);
    expect(Schema.decodeSync(identifiedCodec)(identifiedXml)).toBe("x");

    const titled = Schema.String.annotate({ title: "title" });
    const titledCodec = Xml.fromSchema(titled, { pretty: false });
    const titledXml = "<title>x</title>";

    expect(Schema.encodeSync(titledCodec)("x")).toBe(titledXml);
    expect(Schema.decodeSync(titledCodec)(titledXml)).toBe("x");
  });

  it("uses root when no explicit or annotated name exists", () => {
    const codec = Xml.fromSchema(Schema.String, { pretty: false });
    const xml = "<root>x</root>";

    expect(Schema.encodeSync(codec)("x")).toBe(xml);
    expect(Schema.decodeSync(codec)(xml)).toBe("x");
  });

  it("sorts Struct keys by default and preserves declaration order when disabled", () => {
    const source = Schema.Struct({ z: Schema.String, a: Schema.String });
    const value = { z: "last", a: "first" };
    const sorted = Xml.fromSchema(source, { pretty: false });
    const declared = Xml.fromSchema(source, { pretty: false, sortKeys: false });

    expect(Schema.encodeSync(sorted)(value)).toBe("<root><a>first</a><z>last</z></root>");
    expect(Schema.encodeSync(declared)(value)).toBe("<root><z>last</z><a>first</a></root>");
    expect(Schema.decodeSync(sorted)("<root><a>first</a><z>last</z></root>")).toEqual(value);
    expect(Schema.decodeSync(declared)("<root><z>last</z><a>first</a></root>")).toEqual(value);
  });
});

describe("fromSchema rejection boundary", () => {
  it("rejects Tuple and Record roots in both directions", () => {
    const tupleCodec = Xml.fromSchema(Schema.Tuple([Schema.String]), {
      pretty: false,
    });

    const tupleDecode = Schema.decodeResult(tupleCodec)("<root>x</root>");
    const tupleEncode = Schema.encodeResult(tupleCodec)(["x"]);

    expect(Result.isFailure(tupleDecode)).toBe(true);
    expect(Result.isFailure(tupleEncode)).toBe(true);

    if (Result.isFailure(tupleDecode)) {
      expect(Xml.formatError(tupleDecode.failure)).toContain("homogeneous Arrays, not Tuples");
    }
    if (Result.isFailure(tupleEncode)) {
      expect(Xml.formatError(tupleEncode.failure)).toContain("homogeneous Arrays, not Tuples");
    }

    const recordCodec = Xml.fromSchema(Schema.Record(Schema.String, Schema.String), {
      pretty: false,
    });

    const recordDecode = Schema.decodeResult(recordCodec)("<root>x</root>");
    const recordEncode = Schema.encodeResult(recordCodec)({ x: "x" });

    expect(Result.isFailure(recordDecode)).toBe(true);
    expect(Result.isFailure(recordEncode)).toBe(true);

    if (Result.isFailure(recordDecode)) {
      expect(Xml.formatError(recordDecode.failure)).toContain("records or index signatures");
    }
    if (Result.isFailure(recordEncode)) {
      expect(Xml.formatError(recordEncode.failure)).toContain("records or index signatures");
    }
  });

  it("rejects ambiguous Union and unsupported Null roots in both directions", () => {
    const union = Schema.Union([Schema.Literal("a"), Schema.Literal("b")]);
    const unionCodec = Xml.fromSchema(union, { pretty: false });

    const unionDecode = Schema.decodeResult(unionCodec)("<root>a</root>");
    const unionEncode = Schema.encodeResult(unionCodec)("a");

    expect(Result.isFailure(unionDecode)).toBe(true);
    expect(Result.isFailure(unionEncode)).toBe(true);

    if (Result.isFailure(unionDecode)) {
      expect(Xml.formatError(unionDecode.failure)).toContain("ambiguous unions");
    }
    if (Result.isFailure(unionEncode)) {
      expect(Xml.formatError(unionEncode.failure)).toContain("ambiguous unions");
    }

    const nullCodec = Xml.fromSchema(Schema.Null, { pretty: false });

    const nullDecode = Schema.decodeResult(nullCodec)("<root/>");
    const nullEncode = Schema.encodeResult(nullCodec)(null);

    expect(Result.isFailure(nullDecode)).toBe(true);
    expect(Result.isFailure(nullEncode)).toBe(true);

    if (Result.isFailure(nullDecode)) {
      expect(Xml.formatError(nullDecode.failure)).toContain("does not support this encoded schema");
    }
    if (Result.isFailure(nullEncode)) {
      expect(Xml.formatError(nullEncode.failure)).toContain("does not support this encoded schema");
    }
  });

  it("rejects tuple and record nodes hidden behind transformations before callbacks", () => {
    const tupleTarget = Schema.Tuple([Schema.String]);
    const tupleSource = Schema.String.pipe(
      Schema.decodeTo(
        tupleTarget,
        SchemaTransformation.transform<typeof tupleTarget.Type, string>({
          decode: (): typeof tupleTarget.Type => {
            throw new Error("tuple decode callback ran");
          },
          encode: (): string => {
            throw new Error("tuple encode callback ran");
          },
        }),
      ),
    );
    const tupleCodec = Xml.fromSchema(tupleSource, { pretty: false });

    const tupleDecode = Schema.decodeResult(tupleCodec)("<root>x</root>");
    const tupleEncode = Schema.encodeResult(tupleCodec)(["x"]);

    expect(Result.isFailure(tupleDecode)).toBe(true);
    expect(Result.isFailure(tupleEncode)).toBe(true);

    const recordTarget = Schema.Record(Schema.String, Schema.String);
    const recordSource = Schema.String.pipe(
      Schema.decodeTo(
        recordTarget,
        SchemaTransformation.transform<typeof recordTarget.Type, string>({
          decode: (): typeof recordTarget.Type => {
            throw new Error("record decode callback ran");
          },
          encode: (): string => {
            throw new Error("record encode callback ran");
          },
        }),
      ),
    );
    const recordCodec = Xml.fromSchema(recordSource, { pretty: false });

    const recordDecode = Schema.decodeResult(recordCodec)("<root>x</root>");
    const recordEncode = Schema.encodeResult(recordCodec)({ x: "x" });

    expect(Result.isFailure(recordDecode)).toBe(true);
    expect(Result.isFailure(recordEncode)).toBe(true);
  });

  it("rejects unsupported suspended optional fields even when they are absent", () => {
    const unsupported = Schema.Struct({
      value: Schema.optionalKey(
        Schema.suspend(() =>
          Schema.String.pipe(
            Schema.decodeTo(
              Schema.Tuple([Schema.String]),
              SchemaTransformation.transform<readonly [string], string>({
                decode: (): readonly [string] => {
                  throw new Error("decode callback ran");
                },
                encode: (): string => {
                  throw new Error("encode callback ran");
                },
              }),
            ),
          ),
        ),
      ),
      fallback: Schema.String.pipe(
        Schema.withDecodingDefaultKey(
          Effect.sync(() => {
            throw new Error("default callback ran");
          }),
        ),
      ),
    });
    const codec = Xml.fromSchema(unsupported, { pretty: false });

    expect(Result.isFailure(Schema.decodeUnknownResult(codec)("<root/>"))).toBe(true);
    expect(Result.isFailure(Schema.encodeUnknownResult(codec)({}))).toBe(true);
  });

  it("returns schema failures for invalid root and property names", () => {
    const invalidRoot = Xml.fromSchema(Schema.String, {
      rootName: "not a name",
      pretty: false,
    });
    const invalidKey = Xml.fromSchema(Schema.Struct({ "not a name": Schema.String }), {
      pretty: false,
    });

    const rootDecode = Schema.decodeUnknownResult(invalidRoot)("<root>x</root>");
    const rootEncode = Schema.encodeUnknownResult(invalidRoot)("x");
    const keyDecode = Schema.decodeUnknownResult(invalidKey)("<root/>");
    const keyEncode = Schema.encodeUnknownResult(invalidKey)({ "not a name": "x" });

    expect(Result.isFailure(rootDecode)).toBe(true);
    expect(Result.isFailure(rootEncode)).toBe(true);
    expect(Result.isFailure(keyDecode)).toBe(true);
    expect(Result.isFailure(keyEncode)).toBe(true);
  });
});

describe("fromSchema preserved schema behavior", () => {
  it.effect(
    "retains direction-specific services and runs each service transform once",
    Effect.fn("test/from-schema-services")(function* () {
      class DecodeService extends Context.Service<DecodeService, { readonly prefix: string }>()(
        "test/from-schema/decode",
      ) {}

      class EncodeService extends Context.Service<EncodeService, { readonly prefix: string }>()(
        "test/from-schema/encode",
      ) {}

      let decodes = 0;
      let encodes = 0;

      const source = Schema.Struct({
        value: Schema.String.pipe(
          Schema.decodeTo(
            Schema.Number,
            SchemaTransformation.transformEffect({
              decode: (value) =>
                Effect.map(DecodeService, ({ prefix }) => {
                  decodes++;
                  return Number(value.slice(prefix.length));
                }),
              encode: (value) =>
                Effect.map(EncodeService, ({ prefix }) => {
                  encodes++;
                  return prefix + value;
                }),
            }),
          ),
        ),
      });

      const codec = Xml.fromSchema(source, { pretty: false });

      expectTypeOf(codec.Type).toEqualTypeOf<{ readonly value: number }>();
      expectTypeOf(codec.Encoded).toEqualTypeOf<string>();
      expectTypeOf(codec.DecodingServices).toEqualTypeOf<DecodeService>();
      expectTypeOf(codec.EncodingServices).toEqualTypeOf<EncodeService>();

      const decoded = yield* SchemaParser.decodeEffect(codec)(
        "<root><value>wire:2</value></root>",
      ).pipe(Effect.provideService(DecodeService, { prefix: "wire:" }));

      expect(decoded).toEqual({ value: 2 });
      expect(decodes).toBe(1);
      expect(encodes).toBe(0);

      const encoded = yield* SchemaParser.encodeEffect(codec)(decoded).pipe(
        Effect.provideService(EncodeService, { prefix: "wire:" }),
      );

      expect(encoded).toBe("<root><value>wire:2</value></root>");
      expect(decodes).toBe(1);
      expect(encodes).toBe(1);
    }),
  );

  it("runs source checks, encoding checks, and defaults exactly once per operation", () => {
    const counts = { check: 0, encodingCheck: 0, default: 0 };
    const base = Schema.Struct({
      value: Schema.String,
      defaulted: Schema.String.pipe(
        Schema.withDecodingDefaultKey(
          Effect.sync(() => {
            counts.default++;
            return "fallback";
          }),
          { encodingStrategy: "omit" },
        ),
      ),
    });
    const checked = Schema.make<typeof base>(
      new SchemaAST.Objects(
        base.ast.propertySignatures,
        [],
        undefined,
        [
          new SchemaAST.Filter(() => {
            counts.check++;
            return undefined;
          }),
        ],
        undefined,
        undefined,
        [
          new SchemaAST.Filter(() => {
            counts.encodingCheck++;
            return undefined;
          }),
        ],
      ),
    );
    const codec = Xml.fromSchema(checked, { pretty: false });

    const decoded = Schema.decodeSync(codec)("<root><value>x</value></root>");

    expect(decoded).toEqual({ value: "x", defaulted: "fallback" });
    expect(counts).toEqual({ check: 1, encodingCheck: 1, default: 1 });
    expect(Schema.encodeSync(codec)(decoded)).toBe("<root><value>x</value></root>");
    expect(counts).toEqual({ check: 2, encodingCheck: 2, default: 1 });
  });

  it("keeps the toType projection on typed values and source checks", () => {
    let checks = 0;
    const source = Schema.Struct({ value: Schema.Int }).check(
      Schema.makeFilter(() => {
        checks++;
        return true;
      }),
    );
    const projection = Schema.toType(Xml.fromSchema(source, { pretty: false }));

    expect(Schema.decodeUnknownSync(projection)({ value: 1 })).toEqual({ value: 1 });
    expect(checks).toBe(1);
    expect(Result.isFailure(Schema.decodeUnknownResult(projection)({ value: 1.5 }))).toBe(true);
  });

  it("keeps the toEncoded projection independent of transforms and defaults", () => {
    const source = Schema.Struct({
      value: Schema.String.pipe(
        Schema.decodeTo(
          Schema.String,
          SchemaTransformation.transform<string, string>({
            decode: (): string => {
              throw new Error("source transform ran");
            },
            encode: (): string => {
              throw new Error("source transform ran");
            },
          }),
        ),
      ),
      defaulted: Schema.String.pipe(
        Schema.withDecodingDefaultKey(
          Effect.sync(() => {
            throw new Error("source default ran");
          }),
        ),
      ),
    });
    const projection = Schema.toEncoded(Xml.fromSchema(source, { pretty: false }));
    const xml = "<root><value>x</value></root>";

    expect(Schema.decodeUnknownSync(projection)(xml)).toBe(xml);
    expect(Schema.encodeUnknownSync(projection)(xml)).toBe(xml);
  });

  it("reports scalar and transformed-owner failures at their XML elements", () => {
    const owner = Schema.Struct({ wire: Schema.Number }).pipe(
      Schema.decodeTo(
        Schema.Struct({ model: Schema.Int }),
        SchemaTransformation.transform({
          decode: ({ wire }) => ({ model: wire }),
          encode: ({ model }) => ({ wire: model }),
        }),
      ),
    );
    const cases = [
      {
        codec: Xml.fromSchema(Schema.Struct({ n: Schema.Int }), { locations: false }),
        xml: "<root>\n<n>1.5</n>\n</root>",
        path: '["n"]',
      },
      {
        codec: Xml.fromSchema(Schema.Struct({ owner }), { locations: false }),
        xml: "<root>\n<owner><wire>1.5</wire></owner>\n</root>",
        path: '["owner"]["model"]',
      },
    ];

    for (const located of cases) {
      const result = Schema.decodeUnknownResult(located.codec)(located.xml, {
        reportInput: false,
      });
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        const message = Xml.formatError(result.failure);
        expect(message).toContain("Expected an integer");
        expect(message).toContain("line 2, column 1 (offset 7)");
        expect(message).toContain(located.path);
      }
    }
  });

  it.effect(
    "retains one shared failure leaf with distinct concurrent source provenance",
    Effect.fn("test/from-schema-source-provenance")(function* () {
      const leaf = new SchemaIssue.InvalidValue({ message: "shared sentinel" });
      const firstEntered = Deferred.makeUnsafe<void>();
      const secondEntered = Deferred.makeUnsafe<void>();
      const release = Deferred.makeUnsafe<void>();

      const checked = Schema.String.pipe(
        Schema.decodeTo(
          Schema.String,
          SchemaTransformation.transformEffect<string, string>({
            decode: Effect.fn("test/from-schema-sentinel-leaf")(function* (value) {
              if (value === "first") {
                yield* Deferred.succeed(firstEntered, undefined);
              } else {
                yield* Deferred.succeed(secondEntered, undefined);
              }

              yield* Deferred.await(release);
              return yield* Effect.fail(leaf);
            }),
            encode: Effect.succeed,
          }),
        ),
      );

      const codec = Xml.fromSchema(
        Schema.Struct({
          value: checked,
        }),
        {
          locations: false,
          pretty: false,
        },
      );

      const firstXml = "<root>" + "<value>first</value>" + "</root>";
      const secondXml =
        '<?xml version="1.0"?>' + "\n\n" + "<root>" + "<value>second</value>" + "</root>";

      const decodeBoth = Effect.forEach(
        [firstXml, secondXml],
        (source) => Effect.result(Schema.decodeEffect(codec)(source)),
        { concurrency: "unbounded" },
      );

      const openBarrier = Effect.all(
        [Deferred.await(firstEntered), Deferred.await(secondEntered)],
        { concurrency: "unbounded" },
      ).pipe(Effect.andThen(Deferred.succeed(release, undefined)));

      const execution = yield* Effect.all(
        {
          results: decodeBoth,
          barrier: openBarrier,
        },
        { concurrency: "unbounded" },
      );
      const results = execution.results;

      const messages: Array<string> = [];
      const roots: Array<SchemaIssue.Issue> = [];

      for (const result of results) {
        expect(Result.isFailure(result)).toBe(true);

        if (Result.isFailure(result)) {
          roots.push(result.failure.issue);
          messages.push(Xml.formatError(result.failure));

          const work: Array<SchemaIssue.Issue> = [result.failure.issue];
          let containsLeaf = false;

          while (work.length > 0) {
            const issue = work.pop()!;

            if (issue === leaf) containsLeaf = true;
            if ("issue" in issue) work.push(issue.issue);
            if ("issues" in issue) work.push(...issue.issues);
          }

          expect(containsLeaf).toBe(true);
          expect(result.failure.issue).not.toBe(leaf);
        }
      }

      expect(roots[0]).not.toBe(roots[1]);
      expect(messages[0]).toContain("line 1, column 7 (offset 6)");
      expect(messages[1]).toContain("line 3, column 7 (offset 29)");

      const reformatted: Array<string> = [];
      for (const result of results) {
        if (Result.isFailure(result)) {
          reformatted.push(Xml.formatError(result.failure));
        }
      }

      expect(reformatted).toEqual(messages);
    }),
  );
});
