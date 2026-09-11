import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import * as Xml from "../src/xml.ts";
import * as XmlNode from "../src/xml-node.ts";

const cycleFailure = <A>(result: Result.Result<A, Schema.SchemaError>) => {
  if (Result.isSuccess(result)) throw new Error("Expected cyclic value to be rejected");
  const message = Xml.formatError(result.failure);

  expect(message).toContain("Cyclic");
  expect(message).not.toContain("RangeError");
};

describe("deep recursive documents", () => {
  it("decodes and encodes a 20,000-level typed array tree", () => {
    type Tree = ReadonlyArray<Tree>;

    let tree!: Schema.Codec<Tree, XmlNode.Element>;
    tree = Xml.Element("n", Xml.Array(Xml.suspend(() => tree)));

    const codec = Xml.Document(tree, { pretty: false });
    const depth = 20_000;
    const source = "<n>".repeat(depth) + "</n>".repeat(depth);
    const canonical = "<n>".repeat(depth - 1) + "<n/>" + "</n>".repeat(depth - 1);

    const decoded = Schema.decodeSync(codec)(source);
    let current = decoded;
    let count = 1;
    while (current.length > 0) {
      expect(current).toHaveLength(1);
      current = current[0]!;
      count++;
    }

    const encoded = Schema.encodeSync(codec)(decoded);

    expect(count).toBe(depth);
    expect(encoded).toBe(canonical);
  });

  it("roundtrips a 20,000-level raw tree without replacing node identities", () => {
    const codec = Xml.DocumentNode({ pretty: false });
    const depth = 20_000;
    const source = "<n>".repeat(depth) + "</n>".repeat(depth);
    const canonical = "<n>".repeat(depth - 1) + "<n/>" + "</n>".repeat(depth - 1);

    const document = Schema.decodeSync(codec)(source);
    let current = document.root;
    let count = 1;
    while (current.children.length > 0) {
      const child = current.children[0];
      expect(XmlNode.isElement(child)).toBe(true);
      if (!XmlNode.isElement(child)) throw new Error("Expected a nested element");
      current = child;
      count++;
    }

    const encoded = Schema.encodeSync(codec)(document);
    const identity = Schema.decodeSync(Schema.toType(XmlNode.ChildNode))(document.root);

    expect(count).toBe(depth);
    expect(identity).toBe(document.root);
    expect(encoded).toBe(canonical);
  });
});

describe("cycle detection and sharing", () => {
  it("rejects an array product cycle", () => {
    type Tree = ReadonlyArray<Tree>;

    let tree!: Schema.Codec<Tree, XmlNode.Element>;
    tree = Xml.Element("n", Xml.Array(Xml.suspend(() => tree)));

    const cyclic: Array<Tree> = [];
    cyclic.push(cyclic);

    const result = Schema.encodeResult(Xml.Document(tree))(cyclic);

    cycleFailure(result);
  });

  it("rejects a struct product cycle", () => {
    interface Tree {
      child?: Tree;
    }

    let child!: Schema.Codec<Tree, XmlNode.Element>;
    child = Xml.Element(Xml.Struct({ child: Xml.suspend(() => child).pipe(Schema.optionalKey) }));
    const root = Xml.Element(
      "n",
      Xml.Struct({ child: Xml.suspend(() => child).pipe(Schema.optionalKey) }),
    );

    const cyclic: Tree = {};
    cyclic.child = cyclic;

    const result = Schema.encodeResult(Xml.Document(root))(cyclic);

    cycleFailure(result);
  });

  it("rejects a tuple product cycle", () => {
    type Tree = readonly [Tree];

    let tree!: Schema.Codec<Tree, XmlNode.Element>;
    tree = Xml.Element("n", Xml.Tuple([Xml.suspend(() => tree)]));

    const cyclic: Tree = [undefined!];
    Object.defineProperty(cyclic, 0, { value: cyclic });

    const result = Schema.encodeResult(Xml.Document(tree))(cyclic);

    cycleFailure(result);
  });

  it("allows an array tree to reuse one acyclic subtree", () => {
    type Tree = ReadonlyArray<Tree>;

    let tree!: Schema.Codec<Tree, XmlNode.Element>;
    tree = Xml.Element("n", Xml.Array(Xml.suspend(() => tree)));

    const shared: Tree = [];
    const value: Tree = [shared, shared];
    const codec = Xml.Document(tree, { pretty: false });
    const source = "<n><n/><n/></n>";

    const encoded = Schema.encodeSync(codec)(value);
    const decoded = Schema.decodeSync(codec)(source);

    expect(encoded).toBe(source);
    expect(decoded).toEqual([[], []]);
  });

  it("allows a struct tree to reuse one acyclic subtree", () => {
    interface Tree {
      readonly left?: Tree;
      readonly right?: Tree;
    }

    let child!: Schema.Codec<Tree, XmlNode.Element>;
    child = Xml.Element(
      Xml.Struct({
        left: Xml.suspend(() => child).pipe(Schema.optionalKey),
        right: Xml.suspend(() => child).pipe(Schema.optionalKey),
      }),
    );
    const root = Xml.Element(
      "n",
      Xml.Struct({
        left: Xml.suspend(() => child).pipe(Schema.optionalKey),
        right: Xml.suspend(() => child).pipe(Schema.optionalKey),
      }),
    );

    const shared: Tree = {};
    const value: Tree = { left: shared, right: shared };
    const codec = Xml.Document(root, { pretty: false });
    const source = "<n><left/><right/></n>";

    const encoded = Schema.encodeSync(codec)(value);
    const decoded = Schema.decodeSync(codec)(source);

    expect(encoded).toBe(source);
    expect(decoded).toEqual({ left: {}, right: {} });
  });
});
