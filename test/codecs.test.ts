import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { describe, expect, it } from "vitest";

import * as Xml from "../src/xml.ts";

const failureText = <A>(result: Result.Result<A, Schema.SchemaError>) => {
  if (Result.isSuccess(result)) throw new Error("Expected XML codec to reject the input");
  return Xml.formatError(result.failure);
};

describe("document codecs", () => {
  it("decodes and emits a compact RSS channel with repeated items", () => {
    const item = Xml.Element(
      "item",
      Xml.Struct({
        title: Xml.Element(Schema.String),
        link: Xml.Element(Schema.String),
      }),
    );

    const rss = Xml.Document(
      Xml.Element(
        "rss",
        Xml.Struct({
          version: Xml.Attribute("version", Schema.Literal("2.0")),
          channel: Xml.Element(
            "channel",
            Xml.Struct({
              title: Xml.Element(Schema.String),
              link: Xml.Element(Schema.String),
              items: Xml.Array(item),
            }),
          ),
        }),
      ),
      { pretty: false },
    );
    const source =
      '<rss version="2.0">' +
      "<channel>" +
      "<title>Example Feed</title>" +
      "<link>https://example.test/</link>" +
      "<item>" +
      "<title>First</title>" +
      "<link>https://example.test/1</link>" +
      "</item>" +
      "<item>" +
      "<title>Second</title>" +
      "<link>https://example.test/2</link>" +
      "</item>" +
      "</channel>" +
      "</rss>";

    const expected = {
      version: "2.0" as const,
      channel: {
        title: "Example Feed",
        link: "https://example.test/",
        items: [
          { title: "First", link: "https://example.test/1" },
          { title: "Second", link: "https://example.test/2" },
        ],
      },
    };

    const decoded = Schema.decodeSync(rss)(source);
    const encoded = Schema.encodeSync(rss)(expected);

    expect(decoded).toEqual(expected);
    expect(encoded).toBe(source);
  });

  it("preserves mixed Atom XHTML child kinds through a union", () => {
    const text = Xml.Text(Schema.String).pipe(
      Schema.decodeTo(
        Schema.Struct({ kind: Schema.Literal("text"), value: Schema.String }),
        SchemaTransformation.transform({
          decode: (value) => ({ kind: "text" as const, value }),
          encode: (value) => value.value,
        }),
      ),
    );

    const cdata = Xml.CData(Schema.String).pipe(
      Schema.decodeTo(
        Schema.Struct({ kind: Schema.Literal("cdata"), value: Schema.String }),
        SchemaTransformation.transform({
          decode: (value) => ({ kind: "cdata" as const, value }),
          encode: (value) => value.value,
        }),
      ),
    );

    const xhtml = Xml.Namespace("http://www.w3.org/1999/xhtml");
    const strong = xhtml.Element("strong", Schema.String).pipe(
      Schema.decodeTo(
        Schema.Struct({ kind: Schema.Literal("strong"), value: Schema.String }),
        SchemaTransformation.transform({
          decode: (value) => ({ kind: "strong" as const, value }),
          encode: (value) => value.value,
        }),
      ),
    );

    const atom = Xml.Namespace("http://www.w3.org/2005/Atom");
    const content = Xml.Document(
      atom.Element(
        "content",
        Xml.Struct({
          type: Xml.Attribute("type", Schema.Literal("xhtml")),
          div: xhtml.Element("div", Xml.Array(Xml.Union([text, cdata, strong]))),
        }),
      ),
      { pretty: false },
    );

    const value = {
      type: "xhtml" as const,
      div: [
        { kind: "text" as const, value: "A " },
        { kind: "strong" as const, value: "bold" },
        { kind: "cdata" as const, value: " ending" },
      ],
    };
    const source =
      '<content xmlns="http://www.w3.org/2005/Atom" type="xhtml">' +
      '<div xmlns="http://www.w3.org/1999/xhtml">' +
      "A " +
      "<strong>bold</strong>" +
      "<![CDATA[ ending]]>" +
      "</div>" +
      "</content>";

    const decoded = Schema.decodeSync(content)(source);
    const encoded = Schema.encodeSync(content)(value);

    expect(decoded).toEqual(value);
    expect(encoded).toBe(source);
  });

  it("routes known children independent of source order and emits schema order", () => {
    const codec = Xml.Document(
      Xml.Element(
        "record",
        Xml.Struct({
          first: Xml.Element(Schema.String),
          second: Xml.Element(Schema.String),
        }),
      ),
      { pretty: false },
    );

    const decoded = Schema.decodeSync(codec)("<record><second>B</second><first>A</first></record>");
    const encoded = Schema.encodeSync(codec)({ first: "A", second: "B" });

    expect(decoded).toEqual({ first: "A", second: "B" });
    expect(encoded).toBe("<record><first>A</first><second>B</second></record>");
  });

  it("rejects duplicate known children", () => {
    const codec = Xml.Document(
      Xml.Element(
        "record",
        Xml.Struct({
          title: Xml.Element(Schema.String),
        }),
      ),
    );
    const source = "<record><title>A</title><title>B</title></record>";

    const message = failureText(Schema.decodeResult(codec)(source));

    expect(message).toContain("title");
  });

  it("reports excess children when requested", () => {
    const codec = Xml.Document(
      Xml.Element(
        "record",
        Xml.Struct({
          title: Xml.Element(Schema.String),
        }),
      ),
    );
    const source = "<record><title>A</title><unknown>B</unknown></record>";

    const result = Schema.decodeResult(codec)(source, {
      onExcessProperty: "error",
    });
    const message = failureText(result);

    expect(message).toContain("unknown");
  });

  it("canonicalizes Text and CDATA runs assigned to tuple slots", () => {
    const codec = Xml.Document(
      Xml.Element(
        "r",
        Xml.Tuple([Xml.Text(Schema.String), Xml.CData(Schema.String), Xml.Text(Schema.String)]),
      ),
      { pretty: false },
    );

    const decoded = Schema.decodeSync(codec)("<r>a&#98;<![CDATA[c]]><![CDATA[d]]>e</r>");
    const encoded = Schema.encodeSync(codec)(["ab", "]]>", "e"]);
    const decodedEncoded = Schema.decodeSync(codec)(encoded);

    expect(decoded).toEqual(["ab", "cd", "e"]);
    expect(encoded).toBe("<r>ab<![CDATA[]]]]><![CDATA[>]]>e</r>");
    expect(decodedEncoded).toEqual(["ab", "]]>", "e"]);
  });

  it("rejects adjacent tuple slots that cannot have a canonical boundary", () => {
    const codec = Xml.Document(
      Xml.Element("r", Xml.Tuple([Xml.CData(Schema.String), Xml.CData(Schema.String)])),
    );

    const message = failureText(Schema.encodeResult(codec)(["a", "b"]));

    expect(message).toContain("Adjacent ordered XML CData items");
  });

  it("isolates field names when one nameless suspended codec is shared", () => {
    let forced = 0;
    const shared = Xml.suspend(() => {
      forced++;
      return Xml.Element(Schema.String);
    });

    const codec = Xml.Document(
      Xml.Element(
        "record",
        Xml.Struct({
          left: shared,
          right: shared,
        }),
      ),
      { pretty: false },
    );

    expect(forced).toBe(0);

    const decoded = Schema.decodeSync(codec)("<record><left>A</left><right>B</right></record>");
    const encoded = Schema.encodeSync(codec)({ left: "A", right: "B" });

    expect(decoded).toEqual({ left: "A", right: "B" });
    expect(encoded).toBe("<record><left>A</left><right>B</right></record>");
    expect(forced).toBe(1);
  });

  it("converts scalar attribute and element values", () => {
    const codec = Xml.Document(
      Xml.Element(
        "enclosure",
        Xml.Struct({
          length: Xml.Attribute("length", Schema.FiniteFromString),
          duration: Xml.Element(Schema.FiniteFromString),
        }),
      ),
      { pretty: false },
    );
    const source = '<enclosure length="12345">' + "<duration>61.5</duration>" + "</enclosure>";
    const value = { length: 12_345, duration: 61.5 };

    const decoded = Schema.decodeSync(codec)(source);
    const encoded = Schema.encodeSync(codec)(value);

    expect(decoded).toEqual(value);
    expect(encoded).toBe(source);
  });
});
