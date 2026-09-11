import * as XmlNode from "../../src/xml-node.ts";

type ComparableName = readonly [
  namespaceUri: string | null,
  localName: string,
  prefix: string | null,
];

type ComparableNode =
  | { kind: "text" | "cdata" | "comment"; value: string }
  | { kind: "processing-instruction"; target: string; value: string }
  | {
      kind: "element";
      name: ComparableName;
      namespaceDeclarations: ReadonlyArray<readonly [string | null, string]>;
      attributes: ReadonlyArray<readonly [ComparableName, string]>;
      children: ReadonlyArray<ComparableNode>;
    };

const comparableName = (name: XmlNode.Name): ComparableName => [
  name.namespaceUri ?? null,
  name.localName,
  name.prefix ?? null,
];

const comparableNode = (node: XmlNode.Child): ComparableNode => {
  if (XmlNode.isText(node)) {
    return { kind: "text", value: node.value };
  }

  if (XmlNode.isCData(node)) {
    return { kind: "cdata", value: node.value };
  }

  if (XmlNode.isComment(node)) {
    return { kind: "comment", value: node.value };
  }

  if (XmlNode.isProcessingInstruction(node)) {
    return {
      kind: "processing-instruction",
      target: node.target,
      value: node.value,
    };
  }

  if (!XmlNode.isElement(node)) {
    throw new Error("unexpected XML child node kind");
  }

  const children: Array<ComparableNode> = [];

  for (const child of node.children) {
    const isText = XmlNode.isText(child);
    const isCData = XmlNode.isCData(child);

    if (isText || isCData) {
      const kind = isText ? "text" : "cdata";
      const previous = children.at(-1);
      const previousIsCharacterData = previous?.kind === "text" || previous?.kind === "cdata";

      if (previousIsCharacterData && previous.kind === kind) {
        previous.value += child.value;
      } else {
        children.push({ kind, value: child.value });
      }

      continue;
    }

    children.push(comparableNode(child));
  }

  return {
    kind: "element",
    name: comparableName(node.name),
    namespaceDeclarations: node.namespaceDeclarations.map((declaration) => [
      declaration.prefix ?? null,
      declaration.namespaceUri,
    ]),
    attributes: node.attributes.map((attribute) => [
      comparableName(attribute.name),
      attribute.value,
    ]),
    children,
  };
};

const comparableMisc = (node: XmlNode.Misc): ComparableNode => {
  if (XmlNode.isComment(node)) {
    return { kind: "comment", value: node.value };
  }

  return {
    kind: "processing-instruction",
    target: node.target,
    value: node.value,
  };
};

export const projectDocument = (document: XmlNode.Document) => ({
  declaration:
    document.declaration === undefined
      ? null
      : {
          version: document.declaration.version,
          encoding: document.declaration.encoding ?? null,
          standalone: document.declaration.standalone ?? null,
        },
  prolog: document.prolog.map(comparableMisc),
  root: comparableNode(document.root),
  epilog: document.epilog.map(comparableMisc),
});
