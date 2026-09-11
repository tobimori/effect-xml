import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import * as Xml from "../src/xml.ts";
import * as XmlNode from "../src/xml-node.ts";

const xmlNamespace = "http://www.w3.org/XML/1998/namespace";
const xsiNamespace = "http://www.w3.org/2001/XMLSchema-instance";

describe("Rest", () => {
  it("retains exact unmodeled occurrences and appends them in original order", () => {
    const rawAttributeA = new XmlNode.Attribute({
      name: new XmlNode.Name({ localName: "raw-a" }),
      value: "a",
    });

    const knownAttribute = new XmlNode.Attribute({
      name: new XmlNode.Name({ localName: "id" }),
      value: "known",
    });

    const rawAttributeB = new XmlNode.Attribute({
      name: new XmlNode.Name({ localName: "raw-b" }),
      value: "b",
    });

    const repeatedText = new XmlNode.Text({ value: "raw" });
    const rawCData = new XmlNode.CData({ value: "opaque:QName" });
    const rawComment = new XmlNode.Comment({ value: "untouched" });

    const first = new XmlNode.Element({
      name: new XmlNode.Name({ localName: "first" }),
      namespaceDeclarations: [],
      attributes: [],
      children: [new XmlNode.Text({ value: "1" })],
    });

    const second = new XmlNode.Element({
      name: new XmlNode.Name({ localName: "second" }),
      namespaceDeclarations: [],
      attributes: [],
      children: [new XmlNode.Text({ value: "2" })],
    });

    const input = new XmlNode.Element({
      name: new XmlNode.Name({ localName: "root" }),
      namespaceDeclarations: [],
      attributes: [rawAttributeA, knownAttribute, rawAttributeB],
      children: [repeatedText, second, repeatedText, rawCData, first, rawComment],
    });

    const codec = Xml.Element(
      "root",
      Xml.Struct({
        first: Xml.Element("first", Schema.String),
        rest: Xml.Rest,
        id: Xml.Attribute("id", Schema.String),
        second: Xml.Element("second", Schema.String),
      }),
    );

    const decoded = Schema.decodeSync(codec)(input);

    expect(decoded).toMatchObject({
      first: "1",
      id: "known",
      second: "2",
    });

    expect(decoded.rest.attributes).toEqual([rawAttributeA, rawAttributeB]);
    expect(decoded.rest.attributes[0]).toBe(rawAttributeA);
    expect(decoded.rest.attributes[1]).toBe(rawAttributeB);

    expect(decoded.rest.children).toEqual([repeatedText, repeatedText, rawCData, rawComment]);
    expect(decoded.rest.children[0]).toBe(repeatedText);
    expect(decoded.rest.children[1]).toBe(repeatedText);

    const encoded = Schema.encodeSync(codec)(decoded);

    expect(encoded.attributes).toEqual([knownAttribute, rawAttributeA, rawAttributeB]);
    expect(encoded.children).toEqual([
      expect.objectContaining({
        name: expect.objectContaining({ localName: "first" }),
      }),
      expect.objectContaining({
        name: expect.objectContaining({ localName: "second" }),
      }),
      repeatedText,
      repeatedText,
      rawCData,
      rawComment,
    ]);
    expect(encoded.children.slice(2)).toEqual(decoded.rest.children);

    expect(input.children).toEqual([
      repeatedText,
      second,
      repeatedText,
      rawCData,
      first,
      rawComment,
    ]);
  });

  it("canonicalizes adjacent modeled Text and CDATA runs before claiming Rest", () => {
    const textA = new XmlNode.Text({ value: "a" });
    const textB = new XmlNode.Text({ value: "b" });
    const textInput = new XmlNode.Element({
      name: new XmlNode.Name({ localName: "root" }),
      namespaceDeclarations: [],
      attributes: [],
      children: [textA, textB],
    });
    const textCodec = Xml.Element(
      "root",
      Xml.Struct({
        known: Xml.Text(Schema.String),
        rest: Xml.Rest,
      }),
    );

    const textDecoded = Schema.decodeSync(textCodec)(textInput);

    expect(textDecoded.known).toBe("ab");
    expect(textDecoded.rest.children).toEqual([]);

    const cdataA = new XmlNode.CData({ value: "a" });
    const cdataB = new XmlNode.CData({ value: "b" });
    const cdataInput = new XmlNode.Element({
      name: new XmlNode.Name({ localName: "root" }),
      namespaceDeclarations: [],
      attributes: [],
      children: [cdataA, cdataB],
    });
    const cdataCodec = Xml.Element(
      "root",
      Xml.Struct({
        known: Xml.CData(Schema.String),
        rest: Xml.Rest,
      }),
    );

    const cdataDecoded = Schema.decodeSync(cdataCodec)(cdataInput);

    expect(cdataDecoded.known).toBe("ab");
    expect(cdataDecoded.rest.children).toEqual([]);
  });

  it("keeps original raw nodes when canonical indexes shift around modeled fields", () => {
    const leading = new XmlNode.Text({ value: " " });
    const knownA = new XmlNode.CData({ value: "a" });
    const knownB = new XmlNode.CData({ value: "b" });
    const separator = new XmlNode.Comment({ value: "separator" });
    const trailing = new XmlNode.Text({ value: "tail" });

    const knownElement = new XmlNode.Element({
      name: new XmlNode.Name({ localName: "known" }),
      namespaceDeclarations: [],
      attributes: [],
      children: [new XmlNode.Text({ value: "value" })],
    });

    const original = [
      leading,
      leading,
      knownA,
      knownB,
      separator,
      knownElement,
      trailing,
      trailing,
    ];

    const input = new XmlNode.Element({
      name: new XmlNode.Name({ localName: "root" }),
      namespaceDeclarations: [],
      attributes: [],
      children: original,
    });

    const codec = Xml.Element(
      "root",
      Xml.Struct({
        merged: Xml.CData(Schema.String),
        known: Xml.Element("known", Schema.String),
        rest: Xml.Rest,
      }),
    );

    const decoded = Schema.decodeSync(codec)(input);

    expect(decoded.merged).toBe("ab");
    expect(decoded.known).toBe("value");
    expect(decoded.rest.children).toEqual([leading, leading, separator, trailing, trailing]);

    expect(decoded.rest.children[0]).toBe(leading);
    expect(decoded.rest.children[1]).toBe(leading);
    expect(decoded.rest.children[3]).toBe(trailing);
    expect(decoded.rest.children[4]).toBe(trailing);

    expect(original).toEqual([
      leading,
      leading,
      knownA,
      knownB,
      separator,
      knownElement,
      trailing,
      trailing,
    ]);
  });

  it("keeps adjacent raw CDATA sections separate with their original source spans", () => {
    const codec = Xml.Document(Xml.Element("root", Xml.Struct({ rest: Xml.Rest })), {
      locations: true,
    });
    const source = "<root>" + "<![CDATA[a]]>" + "<![CDATA[b]]>" + "</root>";

    const decoded = Schema.decodeSync(codec)(source);
    const children = decoded.rest.children;

    expect(children).toHaveLength(2);
    expect(children[0]).toBeInstanceOf(XmlNode.CData);
    expect(children[1]).toBeInstanceOf(XmlNode.CData);
    expect(children[0]?.span).toEqual({ start: 6, end: 19 });
    expect(children[1]?.span).toEqual({ start: 19, end: 32 });
  });

  it("roundtrips a complete namespace snapshot without interpreting an opaque QName", () => {
    const namespace = Xml.Namespace("urn:typed", { prefix: "preferred" });
    const codec = Xml.Fragment(
      namespace.Element(
        "owner",
        Xml.Struct({
          known: namespace.Attribute("known", Schema.String),
          rest: Xml.Rest,
        }),
      ),
      { pretty: false },
    );
    const source =
      '<captured:owner xmlns:captured="urn:typed" xmlns:fixed="urn:raw"' +
      ' captured:known="modeled" fixed:raw="opaque:QName">' +
      "<fixed:item/>" +
      "</captured:owner>";

    const decoded = Schema.decodeSync(codec)(source);
    const bindings = decoded.rest.namespaces.bindings.map(({ prefix, namespaceUri }) => [
      prefix,
      namespaceUri,
    ]);

    expect(bindings).toEqual([
      ["xml", xmlNamespace],
      ["captured", "urn:typed"],
      ["fixed", "urn:raw"],
    ]);
    expect(decoded.rest.attributes[0]?.value).toBe("opaque:QName");

    const encoded = Schema.encodeSync(codec)(decoded);

    expect(encoded).toBe(source);
  });

  it("rejects a full snapshot that lacks the typed owner's namespace binding", () => {
    const namespace = Xml.Namespace("urn:typed", { prefix: "preferred" });
    const codec = Xml.Fragment(namespace.Element("owner", Xml.Struct({ rest: Xml.Rest })), {
      pretty: false,
    });

    const opaqueAttribute = new XmlNode.Attribute({
      name: new XmlNode.Name({ localName: "raw" }),
      value: "opaque:QName",
    });

    const namespaces = new Xml.NamespaceContext({
      bindings: [
        new Xml.NamespaceBinding({
          prefix: "xml",
          namespaceUri: xmlNamespace,
        }),
      ],
    });

    const result = Schema.encodeUnknownResult(codec)({
      rest: {
        attributes: [opaqueAttribute],
        children: [],
        namespaces,
      },
    });

    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects Rest content that conflicts with a modeled attribute or child", () => {
    const namespaces = new Xml.NamespaceContext({
      bindings: [
        new Xml.NamespaceBinding({
          prefix: "xml",
          namespaceUri: xmlNamespace,
        }),
      ],
    });

    const attributeCodec = Xml.Document(
      Xml.Element(
        "root",
        Xml.Struct({
          known: Xml.Attribute("known", Schema.String).pipe(Schema.optionalKey),
          rest: Xml.Rest,
        }),
      ),
      { pretty: false },
    );

    const rawKnownAttribute = new XmlNode.Attribute({
      name: new XmlNode.Name({ localName: "known" }),
      value: "raw",
    });

    const attributeResult = Schema.encodeUnknownResult(attributeCodec)({
      rest: {
        attributes: [rawKnownAttribute],
        children: [],
        namespaces,
      },
    });

    expect(Result.isFailure(attributeResult)).toBe(true);

    const childCodec = Xml.Document(
      Xml.Element(
        "root",
        Xml.Struct({
          known: Xml.Element("known", Schema.String).pipe(Schema.optionalKey),
          rest: Xml.Rest,
        }),
      ),
      { pretty: false },
    );

    const rawKnownChild = new XmlNode.Element({
      name: new XmlNode.Name({ localName: "known" }),
      namespaceDeclarations: [],
      attributes: [],
      children: [],
    });

    const childResult = Schema.encodeUnknownResult(childCodec)({
      rest: {
        attributes: [],
        children: [rawKnownChild],
        namespaces,
      },
    });

    expect(Result.isFailure(childResult)).toBe(true);
  });

  it("pretty prints modeled structure without reformatting raw Rest content", () => {
    const codec = Xml.Document(
      Xml.Element(
        "root",
        Xml.Struct({
          known: Xml.Element("known", Schema.String),
          rest: Xml.Rest,
        }),
      ),
      { pretty: true },
    );
    const source =
      "<root>" + "<known>x</known>" + "<foreign><deep/></foreign>" + "tail" + "</root>";

    const decoded = Schema.decodeSync(codec)(source);
    const encoded = Schema.encodeSync(codec)(decoded);

    expect(encoded).toContain("<known>x</known><foreign><deep/></foreign>tail");
    expect(encoded).not.toContain("\n    <deep");

    const emptySource = "<root><known>x</known></root>";
    const empty = Schema.decodeSync(codec)(emptySource);

    expect(Schema.encodeSync(codec)(empty)).toBe(emptySource);
  });
});

describe("Nil", () => {
  it("recognizes all four xsi:nil lexical forms and emits canonical true", () => {
    const codec = Xml.Document(Xml.Nil(Xml.Element("value", Xml.Struct({ rest: Xml.Rest }))), {
      locations: false,
      pretty: false,
    });

    const trueSource = `<value xmlns:xsi="${xsiNamespace}" xsi:nil="true"/>`;
    const oneSource = `<value xmlns:xsi="${xsiNamespace}" xsi:nil="1"/>`;

    expect(Schema.decodeSync(codec)(trueSource)).toBeNull();
    expect(Schema.decodeSync(codec)(oneSource)).toBeNull();

    const falseSource = `<value xmlns:xsi="${xsiNamespace}" xsi:nil="false"/>`;
    const zeroSource = `<value xmlns:xsi="${xsiNamespace}" xsi:nil="0"/>`;
    const decodedFalse = Schema.decodeSync(codec)(falseSource);
    const decodedZero = Schema.decodeSync(codec)(zeroSource);

    expect(decodedFalse).not.toBeNull();
    expect(decodedFalse?.rest.attributes).toEqual([]);
    expect(decodedFalse?.rest.children).toEqual([]);

    expect(decodedZero).not.toBeNull();
    expect(decodedZero?.rest.attributes).toEqual([]);
    expect(decodedZero?.rest.children).toEqual([]);

    const encoded = Schema.encodeSync(codec)(null);

    expect(encoded).toBe(`<value xmlns:xsi="${xsiNamespace}" xsi:nil="true"/>`);
  });

  it("rejects an invalid xsi:nil lexical value", () => {
    const codec = Xml.Document(Xml.Nil(Xml.Element("value", Xml.Struct({ rest: Xml.Rest }))), {
      pretty: false,
    });
    const source = `<value xmlns:xsi="${xsiNamespace}" xsi:nil="yes"/>`;

    const result = Schema.decodeResult(codec)(source);

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(Xml.formatError(result.failure)).toContain(
        "xsi:nil must be one of true, 1, false, or 0",
      );
    }
  });

  it("rejects text, CDATA, and element children when xsi:nil is true", () => {
    const codec = Xml.Document(Xml.Nil(Xml.Element("value", Xml.Struct({ rest: Xml.Rest }))), {
      pretty: false,
    });
    const prefix = `<value xmlns:xsi="${xsiNamespace}" xsi:nil="true">`;
    const suffix = "</value>";
    const sources = [
      prefix + "text" + suffix,
      prefix + "<![CDATA[data]]>" + suffix,
      prefix + "<child/>" + suffix,
    ];

    for (const source of sources) {
      const result = Schema.decodeResult(codec)(source);

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(Xml.formatError(result.failure)).toContain(
          "An xsi:nil element must not contain text, CDATA, or child elements",
        );
      }
    }
  });

  it.effect(
    "keeps nil-projected source locations isolated across concurrent documents",
    Effect.fn("test/nil-source-isolation")(function* () {
      const firstEntered = yield* Deferred.make<void>();
      const secondEntered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();

      const checked = Schema.String.pipe(
        Schema.decodeTo(
          Schema.String,
          SchemaTransformation.transformEffect<string, string>({
            decode: Effect.fn("test/nil-source-sentinel")(function* (value) {
              if (value === "bad") {
                yield* Deferred.succeed(firstEntered, undefined);
              }
              if (value === "worse") {
                yield* Deferred.succeed(secondEntered, undefined);
              }

              yield* Deferred.await(release);
              return yield* Effect.fail(
                new SchemaIssue.InvalidValue({ message: `sentinel-${value}` }),
              );
            }),
            encode: Effect.succeed,
          }),
        ),
      );

      const codec = Xml.Document(
        Xml.Element(
          "root",
          Xml.Struct({
            value: Xml.Nil(
              Xml.Element(
                "value",
                Xml.Struct({
                  inner: Xml.Element("inner", checked),
                }),
              ),
            ),
          }),
        ),
        { locations: false },
      );

      const first =
        "<root>" +
        `<value xmlns:xsi="${xsiNamespace}" xsi:nil="false">` +
        "\n<inner>bad</inner>" +
        "</value>" +
        "</root>";

      const second =
        "<root>" +
        `<value xmlns:xsi="${xsiNamespace}" xsi:nil="0">` +
        "\n\n<inner>worse</inner>" +
        "</value>" +
        "</root>";

      const parsing = Effect.forEach(
        [first, second],
        (source) => Effect.result(Schema.decodeEffect(codec)(source)),
        { concurrency: "unbounded" },
      );

      const openBarrier = Effect.all(
        [Deferred.await(firstEntered), Deferred.await(secondEntered)],
        { concurrency: "unbounded" },
      ).pipe(Effect.andThen(Deferred.succeed(release, undefined)));

      const [results] = yield* Effect.all([parsing, openBarrier], {
        concurrency: "unbounded",
      });

      const messages = results.map((result) => {
        expect(Result.isFailure(result)).toBe(true);
        return Result.isFailure(result) ? Xml.formatError(result.failure) : "";
      });

      expect(messages[0]).toContain("sentinel-bad");
      expect(messages[0]).toContain("line 2, column 1");
      expect(messages[0]).toContain('["value"]["inner"]');
      expect(messages[0]).not.toContain("sentinel-worse");

      expect(messages[1]).toContain("sentinel-worse");
      expect(messages[1]).toContain("line 3, column 1");
      expect(messages[1]).toContain('["value"]["inner"]');
      expect(messages[1]).not.toContain("sentinel-bad");

      const later =
        "<root>" +
        `<value xmlns:xsi="${xsiNamespace}" xsi:nil="false">` +
        "\n\n\n<inner>later</inner>" +
        "</value>" +
        "</root>";

      yield* Effect.result(Schema.decodeEffect(codec)(later));

      const reformatted = results.map((result) =>
        Result.isFailure(result) ? Xml.formatError(result.failure) : "",
      );

      expect(reformatted).toEqual(messages);
    }),
  );
});

describe("shared XML AST occurrences", () => {
  it("resolves a shared child against each parent's namespace scope", () => {
    const shared = new XmlNode.Element({
      name: new XmlNode.Name({ localName: "shared" }),
      namespaceDeclarations: [],
      attributes: [],
      children: [],
    });

    const firstParent = new XmlNode.Element({
      name: new XmlNode.Name({ localName: "parent" }),
      namespaceDeclarations: [
        new XmlNode.NamespaceDeclaration({
          prefix: "p",
          namespaceUri: "urn:first",
        }),
      ],
      attributes: [],
      children: [shared],
    });

    const secondParent = new XmlNode.Element({
      name: new XmlNode.Name({ localName: "parent" }),
      namespaceDeclarations: [
        new XmlNode.NamespaceDeclaration({
          prefix: "p",
          namespaceUri: "urn:second",
        }),
      ],
      attributes: [],
      children: [shared],
    });

    const codec = Xml.Element(
      "parent",
      Xml.Struct({
        shared: Xml.Element("shared", Xml.Struct({ rest: Xml.Rest })),
      }),
    );

    const firstValue = Schema.decodeSync(codec)(firstParent);
    const secondValue = Schema.decodeSync(codec)(secondParent);

    const firstBindings = firstValue.shared.rest.namespaces.bindings.map(
      ({ prefix, namespaceUri }) => [prefix, namespaceUri],
    );
    const secondBindings = secondValue.shared.rest.namespaces.bindings.map(
      ({ prefix, namespaceUri }) => [prefix, namespaceUri],
    );

    expect(firstBindings).toEqual([
      ["xml", xmlNamespace],
      ["p", "urn:first"],
    ]);

    expect(secondBindings).toEqual([
      ["xml", xmlNamespace],
      ["p", "urn:second"],
    ]);
  });

  it("resolves inherited xml:space separately for each shared child occurrence", () => {
    const whitespace = new XmlNode.Text({ value: " " });
    const shared = new XmlNode.Element({
      name: new XmlNode.Name({ localName: "shared" }),
      namespaceDeclarations: [],
      attributes: [],
      children: [whitespace],
    });

    const preserveParent = new XmlNode.Element({
      name: new XmlNode.Name({ localName: "parent" }),
      namespaceDeclarations: [],
      attributes: [
        new XmlNode.Attribute({
          name: new XmlNode.Name({
            localName: "space",
            prefix: "xml",
            namespaceUri: xmlNamespace,
          }),
          value: "preserve",
        }),
      ],
      children: [shared],
    });

    const defaultParent = new XmlNode.Element({
      name: new XmlNode.Name({ localName: "parent" }),
      namespaceDeclarations: [],
      attributes: [
        new XmlNode.Attribute({
          name: new XmlNode.Name({
            localName: "space",
            prefix: "xml",
            namespaceUri: xmlNamespace,
          }),
          value: "default",
        }),
      ],
      children: [shared],
    });

    const sharedCodec = Xml.Element(
      "shared",
      Xml.Struct({
        known: Xml.Element("known", Schema.String).pipe(Schema.optionalKey),
      }),
    );
    const codec = Xml.Element("parent", Xml.Struct({ shared: sharedCodec }));

    const preserveResult = Schema.decodeResult(codec)(preserveParent, {
      onExcessProperty: "error",
    });
    const defaultResult = Schema.decodeResult(codec)(defaultParent, {
      onExcessProperty: "error",
    });

    expect(Result.isFailure(preserveResult)).toBe(true);
    expect(Result.isSuccess(defaultResult)).toBe(true);
  });
});
