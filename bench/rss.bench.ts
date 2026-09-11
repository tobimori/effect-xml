import { Schema } from "effect";
import { describe, expect, test } from "vitest";

import * as Xml from "../src/xml.ts";

const Rss = Xml.Document(
  Xml.Element(
    "rss",
    Xml.Struct({
      version: Xml.Attribute(Schema.String),
      channel: Xml.Element(
        Xml.Struct({
          title: Xml.Element(Schema.String),
          items: Xml.Array(
            Xml.Element(
              "item",
              Xml.Struct({
                title: Xml.Element(Schema.String),
                link: Xml.Element(Schema.String),
                description: Xml.Element(Schema.String),
              }),
            ),
          ),
        }),
      ),
    }),
  ),
  { pretty: false },
);

const source = `<rss version="2.0"><channel><title>News &amp; updates</title>${Array.from(
  { length: 100 },
  (_, index) =>
    "<item>" +
    `<title>Item ${index}</title>` +
    `<link>https://example.test/${index}?a=1&amp;b=2</link>` +
    "<description><![CDATA[Text with <markup> & symbols]]></description>" +
    "</item>",
).join("")}</channel></rss>`;

const Raw = Xml.DocumentNode({ pretty: false });

const decodeRaw = Schema.decodeSync(Raw);
const encodeRaw = Schema.encodeSync(Raw);

const decodeRss = Schema.decodeSync(Rss);
const encodeRss = Schema.encodeSync(Rss);

const raw = decodeRaw(source);
const feed = decodeRss(source);

expect(raw.root.name.localName).toBe("rss");
expect(feed.channel.title).toBe("News & updates");
expect(feed.channel.items).toHaveLength(100);
expect(decodeRss(encodeRaw(raw))).toEqual(feed);
expect(decodeRss(encodeRss(feed))).toEqual(feed);

describe("public RSS codecs with 100 items", () => {
  test("parse to raw AST", async ({ bench }) => {
    let result = raw;

    await bench("parse", () => {
      result = decodeRaw(source);
    }).run();

    expect(result.root.name.localName).toBe("rss");
    expect(result.root.children).toHaveLength(1);
  });

  test("serialize raw AST", async ({ bench }) => {
    let result = "";

    await bench("serialize", () => {
      result = encodeRaw(raw);
    }).run();

    expect(decodeRss(result)).toEqual(feed);
  });

  test("typed decode and encode", async ({ bench }) => {
    let result = "";

    await bench("roundtrip", () => {
      result = encodeRss(decodeRss(source));
    }).run();

    expect(decodeRss(result)).toEqual(feed);
  });
});
