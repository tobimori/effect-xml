import * as SchemaParser from "effect/SchemaParser";
import { describe, expect, it } from "vitest";

import * as Xml from "../src/xml.ts";
import * as XmlNode from "../src/xml-node.ts";

describe("raw XML characters and references", () => {
  it("decodes predefined, decimal, and hexadecimal references", () => {
    const rootStart = '<r a="&quot;&apos;&#65;&#x42;">';
    const textContent = "&amp;&lt;&gt;&#67;&#x44;";
    const source = rootStart + textContent + "</r>";

    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);

    const document = decode(source);
    const text = document.root.children[0];

    expect(document.root.attributes[0]?.value).toBe("\"'AB");

    if (!XmlNode.isText(text)) throw new Error("Expected text content");

    expect(text.value).toBe("&<>CD");
  });

  const invalidCharacterCases: ReadonlyArray<readonly [string, string]> = [
    ["XML 1.0 control reference", "<r>&#1;</r>"],
    ["XML 1.1 null reference", '<?xml version="1.1"?><r>&#0;</r>'],
  ];

  for (const [name, source] of invalidCharacterCases) {
    it(`rejects ${name}`, () => {
      const codec = Xml.DocumentNode();
      const decode = SchemaParser.decodeSync(codec);

      expect(() => decode(source)).toThrow();
    });
  }

  it("accepts XML 1.1 restricted characters through references", () => {
    const source =
      '<?xml version="1.1"?>' +
      "<r>" +
      "&#1;&#8;&#11;&#12;&#14;&#31;&#127;&#132;&#134;&#159;" +
      "</r>";

    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);

    const document = decode(source);
    const text = document.root.children[0];

    if (!XmlNode.isText(text)) throw new Error("Expected text content");

    expect(text.value).toBe("\x01\x08\x0B\x0C\x0E\x1F\x7F\x84\x86\x9F");
  });

  it("rejects an XML 1.1 restricted character when literal", () => {
    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);
    const source = '<?xml version="1.1"?><r>\u000B</r>';

    expect(() => decode(source)).toThrow();
  });

  it("normalizes XML 1.0 line endings but preserves NEL and line separator", () => {
    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);
    const source = "<r>A\r\nB\rC\u0085D\u2028E</r>";

    const document = decode(source);
    const text = document.root.children[0];

    if (!XmlNode.isText(text)) throw new Error("Expected text content");

    expect(text.value).toBe("A\nB\nC\u0085D\u2028E");
  });

  it("normalizes XML 1.1 literal line endings without normalizing references", () => {
    const declaration = '<?xml version="1.1"?>';
    const literalText = "<r>A\r\nB\r\u0085C\u0085D\u2028E";
    const referencedText = "&#xD;&#x85;&#x2028;";
    const source = declaration + literalText + referencedText + "</r>";

    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);

    const document = decode(source);
    const text = document.root.children[0];

    if (!XmlNode.isText(text)) throw new Error("Expected text content");

    expect(text.value).toBe("A\nB\nC\nD\nE\r\u0085\u2028");
  });

  it("normalizes literal attribute whitespace while preserving referenced whitespace", () => {
    const source =
      '<?xml version="1.1"?>' +
      '<r a="A\tB\r\nC\r\u0085D\u0085E\u2028F' +
      '&#x9;&#xA;&#xD;&#x85;&#x2028;"/>';

    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);

    const document = decode(source);
    const attribute = document.root.attributes[0];

    expect(attribute?.value).toBe("A B C D E F\t\n\r\u0085\u2028");
  });

  it("reports source spans in original UTF-16 offsets", () => {
    const source = '<?xml version="1.0"?><r a="😀">x😀<c/></r>';
    const codec = Xml.DocumentNode({ locations: true });
    const decode = SchemaParser.decodeSync(codec);

    const document = decode(source);
    const text = document.root.children[0];
    const child = document.root.children[1];

    expect(document.span).toEqual({ start: 0, end: 42 });
    expect(document.declaration?.span).toEqual({ start: 0, end: 21 });
    expect(document.root.span).toEqual({ start: 21, end: 42 });
    expect(document.root.name.span).toEqual({ start: 22, end: 23 });
    expect(document.root.attributes[0]?.span).toEqual({ start: 24, end: 30 });
    expect(document.root.attributes[0]?.name.span).toEqual({ start: 24, end: 25 });

    if (!XmlNode.isText(text)) throw new Error("Expected text content");
    if (!XmlNode.isElement(child)) throw new Error("Expected child element");

    expect(text.span).toEqual({ start: 31, end: 34 });
    expect(child.span).toEqual({ start: 34, end: 38 });
  });
});

describe("document and fragment boundaries", () => {
  it("parses declaration fields and document miscellany", () => {
    const source =
      '<?xml version="1.1" encoding="UTF-8" standalone="yes"?>' +
      "<!--before-->" +
      "<?setup ok?>" +
      "<r/>" +
      "<?done?>" +
      "<!--after-->";
    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);

    const document = decode(source);

    expect(document.declaration).toMatchObject({
      version: "1.1",
      encoding: "UTF-8",
      standalone: "yes",
    });
    expect(document.prolog.map((node) => node.value)).toEqual(["before", "ok"]);
    expect(document.epilog.map((node) => node.value)).toEqual(["", "after"]);
  });

  const invalidDocumentCases: ReadonlyArray<readonly [string, string]> = [
    ["top-level character data", "text<r/>"],
    ["multiple root elements", "<a/><b/>"],
    ["top-level CDATA", "<![CDATA[x]]><r/>"],
  ];

  for (const [name, source] of invalidDocumentCases) {
    it(`rejects ${name}`, () => {
      const codec = Xml.DocumentNode();
      const decode = SchemaParser.decodeSync(codec);

      expect(() => decode(source)).toThrow();
    });
  }

  it("accepts mixed content and multiple elements in a fragment", () => {
    const text = "text<![CDATA[cdata]]>";
    const markup = "<!--note--><?go now?><a/><b/>";
    const source = text + markup;

    const codec = Xml.FragmentNode();
    const decode = SchemaParser.decodeSync(codec);

    const fragment = decode(source);

    expect(fragment.children[0]).toBeInstanceOf(XmlNode.Text);
    expect(fragment.children[1]).toBeInstanceOf(XmlNode.CData);
    expect(fragment.children[2]).toBeInstanceOf(XmlNode.Comment);
    expect(fragment.children[3]).toBeInstanceOf(XmlNode.ProcessingInstruction);
    expect(fragment.children[4]).toBeInstanceOf(XmlNode.Element);
    expect(fragment.children[5]).toBeInstanceOf(XmlNode.Element);
  });

  it("allows an empty fragment with zero resource budgets", () => {
    const codec = Xml.FragmentNode({
      limits: {
        inputLength: 0,
        depth: 0,
        nodes: 0,
        attributesPerElement: 0,
        textLength: 0,
      },
    });
    const decode = SchemaParser.decodeSync(codec);

    const fragment = decode("");

    expect(fragment.children).toEqual([]);
  });

  it("uses the selected fragment XML version", () => {
    const xml10Codec = Xml.FragmentNode();
    const decodeAsXml10 = SchemaParser.decodeSync(xml10Codec);

    const xml11Codec = Xml.FragmentNode({ version: "1.1" });
    const decodeAsXml11 = SchemaParser.decodeSync(xml11Codec);

    expect(() => decodeAsXml10("&#1;")).toThrow();

    const xml11Fragment = decodeAsXml11("&#1;");
    const child = xml11Fragment.children[0];

    if (!XmlNode.isText(child)) throw new Error("Expected text content");

    expect(child.value).toBe("\x01");
  });

  it("rejects an XML declaration in a fragment", () => {
    const codec = Xml.FragmentNode();
    const decode = SchemaParser.decodeSync(codec);
    const source = '<?xml version="1.0"?><r/>';

    expect(() => decode(source)).toThrow();
  });

  it("rejects document type declarations in documents and fragments", () => {
    const documentCodec = Xml.DocumentNode();
    const decodeDocument = SchemaParser.decodeSync(documentCodec);

    const fragmentCodec = Xml.FragmentNode();
    const decodeFragment = SchemaParser.decodeSync(fragmentCodec);

    const source = "<!DOCTYPE r><r/>";

    expect(() => decodeDocument(source)).toThrow();
    expect(() => decodeFragment(source)).toThrow();
  });
});

describe("namespace processing", () => {
  it("resolves element and attribute expanded names", () => {
    const rootStart = '<r xmlns="urn:default" xmlns:p="urn:parts" plain="v" p:id="7">';
    const source = rootStart + "<p:item/></r>";

    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);

    const document = decode(source);
    const item = document.root.children[0];

    expect(document.root.name).toMatchObject({ localName: "r", namespaceUri: "urn:default" });
    expect(document.root.attributes[0]?.name).toMatchObject({ localName: "plain" });
    expect(document.root.attributes[1]?.name).toMatchObject({
      localName: "id",
      prefix: "p",
      namespaceUri: "urn:parts",
    });

    if (!XmlNode.isElement(item)) throw new Error("Expected child element");

    expect(item.name).toMatchObject({
      localName: "item",
      prefix: "p",
      namespaceUri: "urn:parts",
    });
  });

  it("resets the default namespace locally and restores it for siblings", () => {
    const rootStart = '<r xmlns="urn:outer">';
    const resetBranch = '<plain xmlns=""><leaf/></plain>';
    const source = rootStart + resetBranch + "<again/></r>";

    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);

    const document = decode(source);
    const root = document.root;
    const plain = root.children[0];
    const again = root.children[1];

    if (!XmlNode.isElement(plain) || !XmlNode.isElement(again)) {
      throw new Error("Expected child elements");
    }

    const leaf = plain.children[0];

    if (!XmlNode.isElement(leaf)) throw new Error("Expected leaf element");

    expect(plain.name.namespaceUri).toBeUndefined();
    expect(leaf.name.namespaceUri).toBeUndefined();
    expect(again.name.namespaceUri).toBe("urn:outer");
  });

  it("rejects an unbound prefixed attribute", () => {
    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);
    const source = '<r p:id="1"/>';

    expect(() => decode(source)).toThrow();
  });

  it("rejects duplicate attribute expanded names across prefix aliases", () => {
    const namespaceDeclarations = '<r xmlns:a="urn:id" xmlns:b="urn:id" ';
    const attributes = 'a:key="1" b:key="2"/>';
    const source = namespaceDeclarations + attributes;

    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);

    expect(() => decode(source)).toThrow();
  });

  it("restores an inherited fragment prefix after a local XML 1.1 undeclaration", () => {
    const inheritedPrefix = new Xml.NamespaceBinding({
      prefix: "p",
      namespaceUri: "urn:outer",
    });

    const namespaces = new Xml.NamespaceContext({
      bindings: [inheritedPrefix],
    });
    const codec = Xml.FragmentNode({
      version: "1.1",
      namespaces,
    });
    const decode = SchemaParser.decodeSync(codec);
    const source = '<a xmlns:p=""/><p:b/>';

    const fragment = decode(source);
    const sibling = fragment.children[1];

    if (!XmlNode.isElement(sibling)) throw new Error("Expected sibling element");
    expect(sibling.name.namespaceUri).toBe("urn:outer");
  });
});

describe("raw XML serialization", () => {
  it("escapes text and attributes without changing their values", () => {
    const rootStart = '<r a="&quot;&amp;&lt;&#x9;&#xA;&#xD;">';
    const text = "&amp;&lt;&gt;&#xD;";
    const source = rootStart + text + "</r>";

    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);
    const encode = SchemaParser.encodeSync(codec);

    const document = decode(source);
    const serialized = encode(document);
    const reparsed = decode(serialized);

    expect(serialized).toBe('<r a="&quot;&amp;&lt;&#x9;&#xA;&#xD;">&amp;&lt;&gt;&#xD;</r>');
    expect(reparsed.root.attributes[0]?.value).toBe('"&<\t\n\r');
  });

  it("serializes XML 1.1 normalization-sensitive text as references", () => {
    const text = new XmlNode.Text({
      value: "A\r\u0085\u2028\x01B",
    });
    const fragment = new XmlNode.Fragment({
      children: [text],
    });
    const codec = Xml.FragmentNode({ version: "1.1" });
    const encode = SchemaParser.encodeSync(codec);

    const serialized = encode(fragment);

    expect(serialized).toBe("A&#xD;&#x85;&#x2028;&#x1;B");
  });

  it("rejects an XML 1.0 character that cannot be serialized", () => {
    const text = new XmlNode.Text({ value: "\x01" });
    const fragment = new XmlNode.Fragment({
      children: [text],
    });
    const codec = Xml.FragmentNode();
    const encode = SchemaParser.encodeSync(codec);

    expect(() => encode(fragment)).toThrow();
  });

  it("rejects comment values containing a double hyphen or ending in a hyphen", () => {
    const doubleHyphen = new XmlNode.Comment({ value: "a--b" });
    const doubleHyphenFragment = new XmlNode.Fragment({
      children: [doubleHyphen],
    });

    const trailingHyphen = new XmlNode.Comment({ value: "a-" });
    const trailingHyphenFragment = new XmlNode.Fragment({
      children: [trailingHyphen],
    });

    const codec = Xml.FragmentNode();
    const encode = SchemaParser.encodeSync(codec);

    expect(() => encode(doubleHyphenFragment)).toThrow();
    expect(() => encode(trailingHyphenFragment)).toThrow();
  });

  const invalidInstructionCases: ReadonlyArray<readonly [string, XmlNode.ProcessingInstruction]> = [
    ["reserved xml target", new XmlNode.ProcessingInstruction({ target: "XmL", value: "" })],
    [
      "closing delimiter in data",
      new XmlNode.ProcessingInstruction({ target: "go", value: "a?>b" }),
    ],
    [
      "leading XML whitespace in data",
      new XmlNode.ProcessingInstruction({ target: "go", value: " data" }),
    ],
  ];

  for (const [name, instruction] of invalidInstructionCases) {
    it(`rejects a processing instruction with ${name}`, () => {
      const fragment = new XmlNode.Fragment({
        children: [instruction],
      });
      const codec = Xml.FragmentNode();
      const encode = SchemaParser.encodeSync(codec);

      expect(() => encode(fragment)).toThrow();
    });
  }

  it("writes processing instructions with and without data", () => {
    const first = new XmlNode.ProcessingInstruction({
      target: "first",
      value: "",
    });
    const second = new XmlNode.ProcessingInstruction({
      target: "second",
      value: "data",
    });
    const fragment = new XmlNode.Fragment({
      children: [first, second],
    });
    const codec = Xml.FragmentNode();
    const encode = SchemaParser.encodeSync(codec);

    const serialized = encode(fragment);

    expect(serialized).toBe("<?first?><?second data?>");
  });

  it("splits a CDATA closing delimiter into adjacent CDATA sections", () => {
    const cdata = new XmlNode.CData({ value: "a]]>b" });
    const fragment = new XmlNode.Fragment({
      children: [cdata],
    });
    const codec = Xml.FragmentNode();
    const encode = SchemaParser.encodeSync(codec);
    const decode = SchemaParser.decodeSync(codec);

    const serialized = encode(fragment);
    const reparsed = decode(serialized);

    expect(serialized).toBe("<![CDATA[a]]]]><![CDATA[>b]]>");
    expect(
      reparsed.children
        .filter(XmlNode.isCData)
        .map((node) => node.value)
        .join(""),
    ).toBe("a]]>b");
  });

  it("rejects normalization-sensitive content in literal writer nodes", () => {
    const nodes: ReadonlyArray<XmlNode.Child> = [
      new XmlNode.Comment({ value: "a\r" }),
      new XmlNode.ProcessingInstruction({ target: "go", value: "a\r" }),
      new XmlNode.CData({ value: "a\r" }),
    ];

    const codec = Xml.FragmentNode();
    const encode = SchemaParser.encodeSync(codec);

    for (const node of nodes) {
      const fragment = new XmlNode.Fragment({
        children: [node],
      });

      expect(() => encode(fragment)).toThrow();
    }
  });

  it("roundtrips raw structure and namespace semantics through canonical output", () => {
    const source =
      "<?xml version='1.1'?>" +
      "<r xmlns='urn:r' xmlns:p='urn:p' p:id='7' note='A&#13;'>" +
      "x&amp;" +
      "<![CDATA[y]]>" +
      "<empty></empty>" +
      "</r>";

    const codec = Xml.DocumentNode();
    const decode = SchemaParser.decodeSync(codec);
    const encode = SchemaParser.encodeSync(codec);

    const document = decode(source);
    const serialized = encode(document);
    const reparsed = decode(serialized);
    const empty = reparsed.root.children[2];

    expect(serialized).toBe(
      '<?xml version="1.1"?><r xmlns="urn:r" xmlns:p="urn:p" p:id="7" note="A&#xD;">x&amp;<![CDATA[y]]><empty/></r>',
    );
    expect(reparsed.root.name.namespaceUri).toBe("urn:r");
    expect(reparsed.root.attributes.map((attribute) => attribute.value)).toEqual(["7", "A\r"]);
    expect(XmlNode.getText(reparsed.root)).toBe("x&y");

    if (!XmlNode.isElement(empty)) throw new Error("Expected empty element");

    expect(empty.name.namespaceUri).toBe("urn:r");
  });
});

describe("parser resource limits", () => {
  interface LimitCase {
    readonly name: string;
    readonly accepted: Xml.DocumentNodeOptions;
    readonly exceeded: Xml.DocumentNodeOptions;
  }

  const source = '<r a="12"><x/>abc</r>';

  const exactLimitCases: ReadonlyArray<LimitCase> = [
    {
      name: "input length",
      accepted: { limits: { inputLength: 21 } },
      exceeded: { limits: { inputLength: 20 } },
    },
    {
      name: "depth",
      accepted: { limits: { depth: 2 } },
      exceeded: { limits: { depth: 1 } },
    },
    {
      name: "node count",
      accepted: { limits: { nodes: 3 } },
      exceeded: { limits: { nodes: 2 } },
    },
    {
      name: "attributes per element",
      accepted: { limits: { attributesPerElement: 1 } },
      exceeded: { limits: { attributesPerElement: 0 } },
    },
    {
      name: "decoded text length",
      accepted: { limits: { textLength: 5 } },
      exceeded: { limits: { textLength: 4 } },
    },
  ];

  for (const { name, accepted, exceeded } of exactLimitCases) {
    it(`enforces the ${name} boundary`, () => {
      const acceptedCodec = Xml.DocumentNode(accepted);
      const decodeAccepted = SchemaParser.decodeSync(acceptedCodec);

      const exceededCodec = Xml.DocumentNode(exceeded);
      const decodeExceeded = SchemaParser.decodeSync(exceededCodec);

      const document = decodeAccepted(source);

      expect(document.root.name.localName).toBe("r");
      expect(() => decodeExceeded(source)).toThrow();
    });
  }

  it("rejects a non-finite resource limit", () => {
    const options: Xml.DocumentNodeOptions = {
      limits: {
        nodes: Number.POSITIVE_INFINITY,
      },
    };

    const codec = Xml.DocumentNode(options);
    const decode = SchemaParser.decodeSync(codec);

    expect(() => decode("<r/>")).toThrow();
  });
});
