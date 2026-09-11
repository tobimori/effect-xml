import * as Option from "effect/Option";
import * as SchemaParser from "effect/SchemaParser";
import { describe, expect, it } from "vitest";

import * as Xml from "../src/xml.ts";
import * as XmlNode from "../src/xml-node.ts";

const source =
  '<?xml version="1.0"?>' +
  "<!--before-->" +
  "<?setup yes?>" +
  '<r xmlns="urn:r" xmlns:a="urn:item" xmlns:b="urn:item" plain="v" a:id="7">' +
  "lead" +
  "<![CDATA[+raw]]>" +
  "<a:item/>" +
  "<section><b:item>deep</b:item></section>" +
  "<!--note-->" +
  "<?inside data?>" +
  "tail" +
  '<item xmlns=""/>' +
  "</r>" +
  "<?after?>";

describe("namespace-aware navigation", () => {
  it("finds direct children by expanded name regardless of prefix", () => {
    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);
    const query = Xml.Name("item", {
      namespaceUri: "urn:item",
      prefix: "query",
    });

    const document = decode(source);
    const children = XmlNode.getChildren(document.root, query);

    expect(children).toHaveLength(1);
    expect(children[0]?.name.prefix).toBe("a");
    expect(children[0]?.name.namespaceUri).toBe("urn:item");
  });

  it("treats a string child query as an unnamespaced local name", () => {
    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);

    const document = decode(source);
    const children = XmlNode.getChildren(document.root, "item");

    expect(children).toHaveLength(1);
    expect(children[0]?.name.namespaceUri).toBeUndefined();
  });

  it("returns all direct element children without descending", () => {
    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);

    const document = decode(source);
    const children = XmlNode.getChildren(document.root);

    expect(children.map((child) => child.name.localName)).toEqual(["item", "section", "item"]);
  });

  it("finds attributes by expanded name and returns the attribute node", () => {
    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);
    const query = Xml.Name("id", {
      namespaceUri: "urn:item",
      prefix: "other",
    });

    const document = decode(source);
    const namespaced = XmlNode.getAttribute(document.root, query);
    const plain = XmlNode.getAttribute(document.root, "plain");

    expect(Option.isSome(namespaced)).toBe(true);
    expect(Option.getOrUndefined(namespaced)?.value).toBe("7");
    expect(Option.getOrUndefined(namespaced)?.name.prefix).toBe("a");
    expect(Option.getOrUndefined(plain)?.value).toBe("v");
  });

  it("returns none for absent or namespace-mismatched attributes", () => {
    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);
    const wrongNamespace = Xml.Name("id", {
      namespaceUri: "urn:other",
    });

    const document = decode(source);
    const missing = XmlNode.getAttribute(document.root, "missing");
    const namespaced = XmlNode.getAttribute(document.root, wrongNamespace);
    const unnamespaced = XmlNode.getAttribute(document.root, "id");

    expect(Option.isNone(missing)).toBe(true);
    expect(Option.isNone(namespaced)).toBe(true);
    expect(Option.isNone(unnamespaced)).toBe(true);
  });

  it("compares expanded names rather than lexical prefixes", () => {
    const left = new XmlNode.Name({
      localName: "item",
      namespaceUri: "urn:item",
      prefix: "a",
    });
    const alias = Xml.Name("item", { namespaceUri: "urn:item", prefix: "b" });

    expect(XmlNode.equalsName(left, alias)).toBe(true);
    expect(XmlNode.equalsName(left, Xml.Name("item", { namespaceUri: "urn:other" }))).toBe(false);
    expect(XmlNode.equalsName(left, Xml.Name("other", { namespaceUri: "urn:item" }))).toBe(false);
  });

  it("concatenates direct text and CDATA without descendant or markup content", () => {
    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);

    const document = decode(source);
    const text = XmlNode.getText(document.root);

    expect(text).toBe("lead+rawtail");
  });
});

describe("iterative traversal", () => {
  it("visits a document and its content in source preorder", () => {
    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);

    const document = decode(source);
    const declaration = document.declaration;
    const section = document.root.children[3];
    const visited: Array<XmlNode.Node> = [];

    if (declaration === undefined) throw new Error("Expected an XML declaration");
    if (!XmlNode.isElement(section)) throw new Error("Expected the section element");

    const nestedItem = section.children[0];

    if (!XmlNode.isElement(nestedItem)) throw new Error("Expected the nested item element");

    XmlNode.walk(document, (node) => {
      visited.push(node);
    });

    expect(visited).toEqual([
      document,
      declaration,
      ...document.prolog,
      document.root,
      document.root.children[0],
      document.root.children[1],
      document.root.children[2],
      section,
      nestedItem,
      ...nestedItem.children,
      document.root.children[4],
      document.root.children[5],
      document.root.children[6],
      document.root.children[7],
      ...document.epilog,
    ]);
  });

  it("does not treat names, attributes, or namespace declarations as element content", () => {
    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);
    const document = decode(source);
    const visited: Array<XmlNode.Node> = [];

    XmlNode.walk(document.root, (node) => {
      visited.push(node);
    });

    expect(visited).not.toContain(document.root.name);
    expect(visited).not.toContain(document.root.attributes[0]);
    expect(visited).not.toContain(document.root.namespaceDeclarations[0]);
    expect(visited[0]).toBe(document.root);
  });

  it("visits a standalone leaf exactly once", () => {
    const name = new XmlNode.Name({ localName: "leaf" });
    const visited: Array<XmlNode.Node> = [];

    XmlNode.walk(name, (node) => {
      visited.push(node);
    });

    expect(visited).toEqual([name]);
  });

  it("includes a fragment before its children and preserves child order", () => {
    const first = new XmlNode.Text({ value: "first" });
    const comment = new XmlNode.Comment({ value: "between" });
    const last = new XmlNode.Element({
      name: new XmlNode.Name({ localName: "last" }),
      namespaceDeclarations: [],
      attributes: [],
      children: [],
    });
    const fragment = new XmlNode.Fragment({
      children: [first, comment, last],
    });
    const visited: Array<XmlNode.Node> = [];

    XmlNode.walk(fragment, (node) => {
      visited.push(node);
    });

    expect(visited).toEqual([fragment, first, comment, last]);
  });

  it("visits a shared subtree once for each occurrence", () => {
    const text = new XmlNode.Text({ value: "shared" });
    const shared = new XmlNode.Element({
      name: new XmlNode.Name({ localName: "item" }),
      namespaceDeclarations: [],
      attributes: [],
      children: [text],
    });
    const fragment = new XmlNode.Fragment({
      children: [shared, shared],
    });
    const visited: Array<XmlNode.Node> = [];

    XmlNode.walk(fragment, (node) => {
      visited.push(node);
    });

    expect(visited).toEqual([fragment, shared, text, shared, text]);
  });
});
