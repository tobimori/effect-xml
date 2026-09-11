import { it as effectIt } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { describe, expect, it } from "vitest";

import * as Xml from "../src/xml.ts";
import * as XmlNode from "../src/xml-node.ts";

class CounterService extends Context.Service<CounterService, { uses: number }>()(
  "effect-xml/test/counter-service",
) {}

describe("Effect execution", () => {
  effectIt.effect(
    "runs direct field checks, transforms, and services exactly once",
    Effect.fn("test/direct-field-effects")(function* () {
      let encodedChecks = 0;
      let typeChecks = 0;
      let decodes = 0;
      let encodes = 0;

      const scalar = Schema.String.pipe(
        Schema.check(
          Schema.makeFilter(() => {
            encodedChecks++;
            return true;
          }),
        ),
        Schema.decodeTo(
          Schema.String.pipe(
            Schema.check(
              Schema.makeFilter(() => {
                typeChecks++;
                return true;
              }),
            ),
          ),
          SchemaTransformation.transformEffect({
            decode: (value) =>
              Effect.map(CounterService, (service) => {
                service.uses++;
                decodes++;
                return value;
              }),
            encode: (value) =>
              Effect.map(CounterService, (service) => {
                service.uses++;
                encodes++;
                return value;
              }),
          }),
        ),
      );

      const field = Xml.Element(scalar);
      const codec = Xml.Document(
        Xml.Element(
          "record",
          Xml.Struct({
            title: field,
          }),
        ),
        { pretty: false },
      );

      const service = { uses: 0 };
      const decoded = yield* Schema.decodeEffect(codec)("<record><title>A</title></record>").pipe(
        Effect.provideService(CounterService, service),
      );

      expect(decoded).toEqual({ title: "A" });
      expect({ encodedChecks, typeChecks, decodes, encodes, serviceUses: service.uses }).toEqual({
        encodedChecks: 1,
        typeChecks: 1,
        decodes: 1,
        encodes: 0,
        serviceUses: 1,
      });

      encodedChecks = 0;
      typeChecks = 0;
      decodes = 0;
      encodes = 0;
      service.uses = 0;

      const encoded = yield* Schema.encodeEffect(codec)({ title: "A" }).pipe(
        Effect.provideService(CounterService, service),
      );

      expect(encoded).toBe("<record><title>A</title></record>");
      expect({ encodedChecks, typeChecks, decodes, encodes, serviceUses: service.uses }).toEqual({
        encodedChecks: 1,
        typeChecks: 1,
        decodes: 0,
        encodes: 1,
        serviceUses: 1,
      });
    }),
  );

  effectIt.effect(
    "runs suspended field checks, transforms, and services exactly once",
    Effect.fn("test/suspended-field-effects")(function* () {
      let encodedChecks = 0;
      let typeChecks = 0;
      let decodes = 0;
      let encodes = 0;

      const scalar = Schema.String.pipe(
        Schema.check(
          Schema.makeFilter(() => {
            encodedChecks++;
            return true;
          }),
        ),
        Schema.decodeTo(
          Schema.String.pipe(
            Schema.check(
              Schema.makeFilter(() => {
                typeChecks++;
                return true;
              }),
            ),
          ),
          SchemaTransformation.transformEffect({
            decode: (value) =>
              Effect.map(CounterService, (service) => {
                service.uses++;
                decodes++;
                return value;
              }),
            encode: (value) =>
              Effect.map(CounterService, (service) => {
                service.uses++;
                encodes++;
                return value;
              }),
          }),
        ),
      );

      const field = Xml.suspend(() => Xml.Element(scalar));
      const codec = Xml.Document(
        Xml.Element(
          "record",
          Xml.Struct({
            title: field,
          }),
        ),
        { pretty: false },
      );

      const service = { uses: 0 };
      const decoded = yield* Schema.decodeEffect(codec)("<record><title>A</title></record>").pipe(
        Effect.provideService(CounterService, service),
      );

      expect(decoded).toEqual({ title: "A" });
      expect({ encodedChecks, typeChecks, decodes, encodes, serviceUses: service.uses }).toEqual({
        encodedChecks: 1,
        typeChecks: 1,
        decodes: 1,
        encodes: 0,
        serviceUses: 1,
      });

      encodedChecks = 0;
      typeChecks = 0;
      decodes = 0;
      encodes = 0;
      service.uses = 0;

      const encoded = yield* Schema.encodeEffect(codec)({ title: "A" }).pipe(
        Effect.provideService(CounterService, service),
      );

      expect(encoded).toBe("<record><title>A</title></record>");
      expect({ encodedChecks, typeChecks, decodes, encodes, serviceUses: service.uses }).toEqual({
        encodedChecks: 1,
        typeChecks: 1,
        decodes: 0,
        encodes: 1,
        serviceUses: 1,
      });
    }),
  );
});

describe("property signatures", () => {
  it("preserves optional-key behavior for direct fields", () => {
    const field = Xml.Element(Schema.String).pipe(Schema.optionalKey);
    const codec = Xml.Document(
      Xml.Element(
        "record",
        Xml.Struct({
          title: field,
        }),
      ),
      { pretty: false },
    );

    const missing = Schema.decodeSync(codec)("<record/>");
    const present = Schema.decodeSync(codec)("<record><title>A</title></record>");
    const encoded = Schema.encodeSync(codec)({});

    expect(missing).toEqual({});
    expect(present).toEqual({ title: "A" });
    expect(encoded).toBe("<record/>");
  });

  it("preserves optional-key behavior for suspended fields", () => {
    const field = Xml.suspend(() => Xml.Element(Schema.String)).pipe(Schema.optionalKey);
    const codec = Xml.Document(
      Xml.Element(
        "record",
        Xml.Struct({
          title: field,
        }),
      ),
      { pretty: false },
    );

    const missing = Schema.decodeSync(codec)("<record/>");
    const present = Schema.decodeSync(codec)("<record><title>A</title></record>");
    const encoded = Schema.encodeSync(codec)({});

    expect(missing).toEqual({});
    expect(present).toEqual({ title: "A" });
    expect(encoded).toBe("<record/>");
  });

  it("applies direct field defaults only when a property is missing", () => {
    const fragment = Schema.decodeSync(Xml.FragmentNode())("<title>default</title>");
    const defaultNode = fragment.children[0];

    if (!XmlNode.isElement(defaultNode)) throw new Error("Expected an element fixture");

    let defaults = 0;
    const field = Xml.Element(Schema.String).pipe(
      Schema.withDecodingDefaultKey(
        Effect.sync(() => {
          defaults++;
          return defaultNode;
        }),
      ),
    );
    const codec = Xml.Document(
      Xml.Element(
        "record",
        Xml.Struct({
          title: field,
        }),
      ),
      { pretty: false },
    );

    const missing = Schema.decodeSync(codec)("<record/>");
    const present = Schema.decodeSync(codec)("<record><title>A</title></record>");
    const encoded = Schema.encodeSync(codec)({ title: "A" });

    expect(missing).toEqual({ title: "default" });
    expect(present).toEqual({ title: "A" });
    expect(encoded).toBe("<record><title>A</title></record>");
    expect(defaults).toBe(1);
  });

  it("applies suspended field defaults only when a property is missing", () => {
    const fragment = Schema.decodeSync(Xml.FragmentNode())("<title>default</title>");
    const defaultNode = fragment.children[0];

    if (!XmlNode.isElement(defaultNode)) throw new Error("Expected an element fixture");

    let defaults = 0;
    const field = Xml.suspend(() => Xml.Element(Schema.String)).pipe(
      Schema.withDecodingDefaultKey(
        Effect.sync(() => {
          defaults++;
          return defaultNode;
        }),
      ),
    );
    const codec = Xml.Document(
      Xml.Element(
        "record",
        Xml.Struct({
          title: field,
        }),
      ),
      { pretty: false },
    );

    const missing = Schema.decodeSync(codec)("<record/>");
    const present = Schema.decodeSync(codec)("<record><title>A</title></record>");
    const encoded = Schema.encodeSync(codec)({ title: "A" });

    expect(missing).toEqual({ title: "default" });
    expect(present).toEqual({ title: "A" });
    expect(encoded).toBe("<record><title>A</title></record>");
    expect(defaults).toBe(1);
  });

  it("omits direct defaulted fields when encodingStrategy is omit", () => {
    const fragment = Schema.decodeSync(Xml.FragmentNode())("<title>default</title>");
    const defaultNode = fragment.children[0];

    if (!XmlNode.isElement(defaultNode)) throw new Error("Expected an element fixture");

    const field = Xml.Element(Schema.String).pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(defaultNode), {
        encodingStrategy: "omit",
      }),
    );
    const codec = Xml.Document(
      Xml.Element(
        "record",
        Xml.Struct({
          title: field,
        }),
      ),
      { pretty: false },
    );

    const encoded = Schema.encodeSync(codec)({ title: "A" });
    const decoded = Schema.decodeSync(codec)("<record/>");

    expect(encoded).toBe("<record/>");
    expect(decoded).toEqual({ title: "default" });
  });

  it("omits suspended defaulted fields when encodingStrategy is omit", () => {
    const fragment = Schema.decodeSync(Xml.FragmentNode())("<title>default</title>");
    const defaultNode = fragment.children[0];

    if (!XmlNode.isElement(defaultNode)) throw new Error("Expected an element fixture");

    const field = Xml.suspend(() => Xml.Element(Schema.String)).pipe(
      Schema.withDecodingDefaultKey(Effect.succeed(defaultNode), {
        encodingStrategy: "omit",
      }),
    );
    const codec = Xml.Document(
      Xml.Element(
        "record",
        Xml.Struct({
          title: field,
        }),
      ),
      { pretty: false },
    );

    const encoded = Schema.encodeSync(codec)({ title: "A" });
    const decoded = Schema.decodeSync(codec)("<record/>");

    expect(encoded).toBe("<record/>");
    expect(decoded).toEqual({ title: "default" });
  });
});

describe("schema projections", () => {
  it("toType accepts modeled values without running the XML transformation", () => {
    let transformations = 0;

    const scalar = Schema.String.pipe(
      Schema.decodeTo(
        Schema.Struct({ value: Schema.String }),
        SchemaTransformation.transform({
          decode: (value) => {
            transformations++;
            return { value };
          },
          encode: (value) => {
            transformations++;
            return value.value;
          },
        }),
      ),
    );
    const codec = Xml.suspend(() => Xml.Element("title", scalar));
    const value = { value: "A" };

    const decoded = Schema.decodeSync(Schema.toType(codec))(value);
    const encoded = Schema.encodeSync(Schema.toType(codec))(value);

    expect(decoded).toEqual({ value: "A" });
    expect(encoded).toEqual({ value: "A" });
    expect(transformations).toBe(0);
  });

  it("toEncoded preserves public XML node identity without transformations", () => {
    let transformations = 0;

    const scalar = Schema.String.pipe(
      Schema.decodeTo(
        Schema.String,
        SchemaTransformation.transform({
          decode: (value) => {
            transformations++;
            return value;
          },
          encode: (value) => {
            transformations++;
            return value;
          },
        }),
      ),
    );
    const codec = Xml.suspend(() => Xml.Element("title", scalar));
    const fragment = Schema.decodeSync(Xml.FragmentNode())("<title>A</title>");
    const node = fragment.children[0];

    if (!XmlNode.isElement(node)) throw new Error("Expected an element fixture");

    const decoded = Schema.decodeSync(Schema.toEncoded(codec))(node);
    const encoded = Schema.encodeUnknownSync(Schema.toEncoded(codec))(node);

    expect(decoded).toBe(node);
    expect(encoded).toBe(node);
    expect(transformations).toBe(0);
  });

  effectIt.effect(
    "flip reverses a serviceful XML transformation exactly once",
    Effect.fn("test/flipped-xml-codec")(function* () {
      const scalar = Schema.String.pipe(
        Schema.decodeTo(
          Schema.String,
          SchemaTransformation.transformEffect({
            decode: (value) =>
              Effect.map(CounterService, (service) => {
                service.uses++;
                return `${value}!`;
              }),
            encode: (value) =>
              Effect.map(CounterService, (service) => {
                service.uses++;
                return value.slice(0, -1);
              }),
          }),
        ),
      );
      const codec = Xml.suspend(() => Xml.Element("title", scalar));
      const fragment = yield* Schema.decodeEffect(Xml.FragmentNode())("<title>A</title>");
      const node = fragment.children[0];

      if (!XmlNode.isElement(node)) throw new Error("Expected an element fixture");

      const service = { uses: 0 };
      const raw = yield* Schema.decodeEffect(Schema.flip(codec))("A!").pipe(
        Effect.provideService(CounterService, service),
      );

      expect(raw).toEqual(node);
      expect(service.uses).toBe(1);

      service.uses = 0;

      const modeled = yield* Schema.encodeUnknownEffect(Schema.flip(codec))(node).pipe(
        Effect.provideService(CounterService, service),
      );

      expect(modeled).toBe("A!");
      expect(service.uses).toBe(1);
    }),
  );
});

it("honors errors all and reportInput for independent field failures", () => {
  const digits = Schema.String.check(Schema.isPattern(/^ok-/u));
  const codec = Xml.Document(
    Xml.Element(
      "record",
      Xml.Struct({
        first: Xml.Element(digits),
        second: Xml.Element(digits),
      }),
    ),
  );
  const source = "<record>" + "<first>bad-one</first>" + "<second>bad-two</second>" + "</record>";

  const result = Schema.decodeResult(codec)(source, {
    errors: "all",
    reportInput: true,
  });

  if (Result.isSuccess(result)) throw new Error("Expected both string fields to fail");

  const message = Xml.formatError(result.failure);
  const work: Array<SchemaIssue.Issue> = [result.failure.issue];
  const reportedInputs: Array<unknown> = [];

  while (work.length > 0) {
    const issue = work.pop();
    if (issue === undefined) continue;

    if (SchemaIssue.hasInput(issue)) reportedInputs.push(issue.input);

    if (Predicate.isTagged(issue, "Encoding")) {
      work.push(issue.issue);
      continue;
    }
    if (Predicate.isTagged(issue, "Pointer")) {
      work.push(issue.issue);
      continue;
    }
    if (Predicate.isTagged(issue, "Filter")) {
      work.push(issue.issue);
      continue;
    }
    if (Predicate.isTagged(issue, "Composite")) {
      work.push(...issue.issues);
      continue;
    }
    if (Predicate.isTagged(issue, "AnyOf")) work.push(...issue.issues);
  }

  expect(message).toContain('["first"]');
  expect(message).toContain('["second"]');
  expect(message).toContain("bad-one");
  expect(message).toContain("bad-two");
  expect(reportedInputs).toContain("bad-one");
  expect(reportedInputs).toContain("bad-two");
});

effectIt.effect(
  "keeps exact shared issue leaves and concurrent document locations isolated",
  Effect.fn("test/concurrent-issue-provenance")(function* () {
    const sentinel = new SchemaIssue.InvalidValue({ message: "shared-sentinel" });
    const sources = ["<r>0</r>", "<!--x--><r>1</r>", "<!--xxxx--><r>2</r>"];
    const expectedColumns = [1, 9, 12];

    const arrivals = yield* Effect.forEach(sources, () => Deferred.make<void>());
    const release = yield* Deferred.make<void>();

    const scalar = Schema.String.pipe(
      Schema.decodeTo(
        Schema.String,
        SchemaTransformation.transformEffect<string, string>({
          decode: (value) => {
            const arrival = arrivals[Number(value)]!;

            return Deferred.succeed(arrival, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(Effect.fail(sentinel)),
            );
          },
          encode: (value) => Effect.succeed(value),
        }),
      ),
    );
    const codec = Xml.Document(Xml.Element("r", scalar));

    const parsing = Effect.forEach(
      sources,
      (source) => Effect.result(Schema.decodeEffect(codec)(source)),
      { concurrency: "unbounded" },
    );
    const openBarrier = Effect.forEach(arrivals, Deferred.await, {
      concurrency: "unbounded",
    }).pipe(Effect.andThen(Deferred.succeed(release, undefined)));

    const [results] = yield* Effect.all([parsing, openBarrier], {
      concurrency: "unbounded",
    });

    for (let index = 0; index < results.length; index++) {
      const result = results[index]!;

      if (Result.isSuccess(result)) throw new Error("Expected sentinel failure");

      const work: Array<SchemaIssue.Issue> = [result.failure.issue];
      let foundSentinel = false;

      while (work.length > 0) {
        const issue = work.pop();
        if (issue === undefined) continue;

        if (issue === sentinel) foundSentinel = true;

        if (Predicate.isTagged(issue, "Encoding")) {
          work.push(issue.issue);
          continue;
        }
        if (Predicate.isTagged(issue, "Pointer")) {
          work.push(issue.issue);
          continue;
        }
        if (Predicate.isTagged(issue, "Filter")) {
          work.push(issue.issue);
          continue;
        }
        if (Predicate.isTagged(issue, "Composite")) {
          work.push(...issue.issues);
          continue;
        }
        if (Predicate.isTagged(issue, "AnyOf")) work.push(...issue.issues);
      }

      const formatted = Xml.formatError(result.failure);

      expect(foundSentinel).toBe(true);
      expect(formatted).toContain(`column ${expectedColumns[index]} `);
    }
  }),
);
