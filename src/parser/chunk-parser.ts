import * as Data from "effect/Data";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as SchemaIssue from "effect/SchemaIssue";

import { Attribute } from "../ast/attribute.ts";
import { Comment } from "../ast/comment.ts";
import { Declaration } from "../ast/declaration.ts";
import { Document, type Misc } from "../ast/document.ts";
import { Element, type Child } from "../ast/element.ts";
import type { SourceSpan } from "../ast/location.ts";
import { Name } from "../ast/name.ts";
import { NamespaceDeclaration } from "../ast/namespace-declaration.ts";
import type { Node } from "../ast/node.ts";
import { ProcessingInstruction } from "../ast/processing-instruction.ts";
import { CData, Text } from "../ast/text.ts";
import { validateBinding, xmlNamespace } from "../namespace/validation.ts";
import type { XmlLocation } from "../schema/provenance.ts";
import { isNcName, isXml10Char, isXml10NameChar, isXml10NameStart } from "./character.ts";
import type { ParseOptions, ParserLimits } from "./types.ts";

interface Mark {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

class ParseFailure extends Data.TaggedError("ParseFailure")<{
  readonly detail: string;
  readonly location: Mark;
}> {}

interface QualifiedName {
  readonly lexical: string;
  readonly localName: string;
  readonly prefix: string | undefined;
  readonly mark: Mark;
  readonly end: number;
}

interface RawAttribute {
  readonly name: QualifiedName;
  readonly value: string;
  readonly mark: Mark;
  readonly end: number;
}

interface NamespaceChange {
  readonly prefix: string;
  readonly hadPrevious: boolean;
  readonly previous: string | undefined;
}

interface DeclarationFields {
  version: "1.0";
  encoding?: string;
  standalone?: "yes" | "no";
  span?: SourceSpan;
}

interface NameFields {
  localName: string;
  namespaceUri?: string;
  prefix?: string;
  span?: SourceSpan;
}

interface NamespaceDeclarationFields {
  prefix?: string;
  namespaceUri: string;
  span?: SourceSpan;
}

interface DocumentFields {
  declaration?: Declaration;
  prolog: ReadonlyArray<Misc>;
  root: Element;
  epilog: ReadonlyArray<Misc>;
  span?: SourceSpan;
}

interface Frame {
  readonly lexicalName: string;
  readonly name: Name;
  readonly namespaceDeclarations: Array<NamespaceDeclaration>;
  readonly attributes: Array<Attribute>;
  readonly children: Array<Child>;
  readonly namespaceChanges: Array<NamespaceChange>;
  readonly start: Mark;
}

const startMark: Mark = { offset: 0, line: 1, column: 1 };

const isXmlWhitespaceCode = (code: number | undefined) =>
  code === 0x20 || code === 0x9 || code === 0xa || code === 0xd;

const isAsciiDigit = (code: number) => code >= 0x30 && code <= 0x39;

const asciiDigitValue = (code: number, hexadecimal: boolean) => {
  if (isAsciiDigit(code)) return code - 0x30;
  if (!hexadecimal) return undefined;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return undefined;
};

const namedReferences: ReadonlyArray<readonly [string, string]> = [
  ["amp;", "&"],
  ["lt;", "<"],
  ["gt;", ">"],
  ["quot;", '"'],
  ["apos;", "'"],
];

class StringBuilder {
  private readonly pieces: Array<string> = [];
  private pending = "";

  append(value: string) {
    if (value.length === 0) return;
    if (this.pending.length + value.length <= 4096) {
      this.pending += value;
      return;
    }
    if (this.pending.length > 0) {
      this.pieces.push(this.pending);
      this.pending = "";
    }
    if (value.length > 4096) this.pieces.push(value);
    else this.pending = value;
  }

  finish() {
    if (this.pending.length > 0) this.pieces.push(this.pending);
    return this.pieces.join("");
  }
}

class Cursor {
  index = 0;
  line = 1;
  column = 1;
  private previousWasCarriageReturn = false;
  private readonly iterator: Iterator<string>;
  private readonly segments: Array<string> = [];
  private segmentIndex = 0;
  private segmentOffset = 0;
  private available = 0;
  private loaded = 0;
  private ended = false;
  private readonly inputLengthLimit: number | undefined;

  constructor(chunks: Iterable<string>, inputLengthLimit: number | undefined) {
    this.iterator = chunks[Symbol.iterator]();
    this.inputLengthLimit = inputLengthLimit;
  }

  private compact() {
    if (this.segmentIndex < 1024) return;
    this.segments.splice(0, this.segmentIndex);
    this.segmentIndex = 0;
  }

  private ensure(count: number) {
    while (this.available < count && !this.ended) {
      const next = this.iterator.next();
      if (next.done) {
        this.ended = true;
        break;
      }
      if (!Predicate.isString(next.value)) {
        this.fail("XML input chunks must be strings");
      }
      if (next.value.length === 0) continue;
      if (
        this.inputLengthLimit !== undefined &&
        next.value.length > this.inputLengthLimit - this.loaded
      ) {
        this.fail(
          `Parser inputLength limit of ${this.inputLengthLimit} UTF-16 code units was exceeded`,
        );
      }
      this.segments.push(next.value);
      this.available += next.value.length;
      this.loaded += next.value.length;
    }
  }

  get done() {
    this.ensure(1);
    return this.available === 0;
  }

  mark() {
    return { offset: this.index, line: this.line, column: this.column };
  }

  startsWith(value: string) {
    this.ensure(value.length);
    if (this.available < value.length) return false;
    for (let index = 0; index < value.length; index++) {
      if (this.codeUnit(index) !== value.charCodeAt(index)) return false;
    }
    return true;
  }

  codeUnit(relativeOffset = 0) {
    this.ensure(relativeOffset + 1);
    if (relativeOffset >= this.available) return undefined;
    let segmentIndex = this.segmentIndex;
    let offset = this.segmentOffset + relativeOffset;
    while (true) {
      const segment = this.segments[segmentIndex];
      if (segment === undefined) return undefined;
      if (offset < segment.length) return segment.charCodeAt(offset);
      offset -= segment.length;
      segmentIndex += 1;
    }
  }

  codePoint() {
    const first = this.codeUnit();
    if (first === undefined) return undefined;
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = this.codeUnit(1);
      if (second !== undefined && second >= 0xdc00 && second <= 0xdfff) {
        return (first - 0xd800) * 0x400 + second - 0xdc00 + 0x10000;
      }
    }
    return first;
  }

  validCodePoint() {
    const mark = this.mark();
    const codePoint = this.codePoint();
    if (codePoint === undefined || !isXml10Char(codePoint)) {
      const display =
        codePoint === undefined ? "unknown" : `U+${codePoint.toString(16).toUpperCase()}`;
      this.fail(`Character ${display} is not permitted by XML 1.0`, mark);
    }
    return codePoint;
  }

  advance(count = 1) {
    let advanced = 0;
    while (advanced < count) {
      const codePoint = this.validCodePoint();
      const width = codePoint > 0xffff ? 2 : 1;
      if (advanced + width > count) {
        this.fail("Cannot split a Unicode surrogate pair");
      }
      for (let unit = 0; unit < width; unit++) {
        const code = this.codeUnit();
        if (code === undefined) this.fail("Unexpected end of XML input");
        this.segmentOffset += 1;
        this.available -= 1;
        this.index += 1;
        advanced += 1;
        if (code === 0xd) {
          this.line += 1;
          this.column = 1;
          this.previousWasCarriageReturn = true;
        } else if (code === 0xa) {
          if (!this.previousWasCarriageReturn) this.line += 1;
          this.column = 1;
          this.previousWasCarriageReturn = false;
        } else {
          this.column += 1;
          this.previousWasCarriageReturn = false;
        }
        const segment = this.segments[this.segmentIndex];
        if (segment !== undefined && this.segmentOffset === segment.length) {
          this.segments[this.segmentIndex] = "";
          this.segmentIndex += 1;
          this.segmentOffset = 0;
          this.compact();
        }
      }
    }
  }

  skipWhitespace() {
    const start = this.index;
    while (isXmlWhitespaceCode(this.codeUnit())) this.advance();
    return this.index !== start;
  }

  // RETURN TYPE: Call sites rely on this method for control-flow narrowing.
  fail(detail: string, location = this.mark()): never {
    throw new ParseFailure({ detail, location });
  }

  expect(value: string, detail: string) {
    if (!this.startsWith(value)) this.fail(detail);
    this.advance(value.length);
  }

  readName(context: string) {
    const mark = this.mark();
    const first = this.codePoint();
    if (first === undefined || !isXml10NameStart(first)) this.fail(`Expected ${context}`, mark);
    const builder = new StringBuilder();
    builder.append(String.fromCodePoint(first));
    this.advance(first > 0xffff ? 2 : 1);
    while (!this.done) {
      const codePoint = this.codePoint();
      if (codePoint === undefined || !isXml10NameChar(codePoint)) break;
      builder.append(String.fromCodePoint(codePoint));
      this.advance(codePoint > 0xffff ? 2 : 1);
    }
    return { value: builder.finish(), mark, end: this.index };
  }
}

const makeIssue = (failure: ParseFailure) =>
  new SchemaIssue.InvalidValue({
    message: `Expected well-formed XML\n${failure.detail}\n  at line ${failure.location.line}, column ${failure.location.column} (offset ${failure.location.offset})`,
  });

const splitQualifiedName = (cursor: Cursor, name: ReturnType<Cursor["readName"]>) => {
  const colon = name.value.indexOf(":");
  if (colon === -1) {
    if (!isNcName(name.value))
      cursor.fail(`Invalid XML qualified name ${JSON.stringify(name.value)}`, name.mark);
    return {
      lexical: name.value,
      localName: name.value,
      prefix: undefined,
      mark: name.mark,
      end: name.end,
    };
  }
  if (colon === 0 || colon === name.value.length - 1 || name.value.indexOf(":", colon + 1) !== -1) {
    cursor.fail(`Invalid XML qualified name ${JSON.stringify(name.value)}`, name.mark);
  }
  const prefix = name.value.slice(0, colon);
  const localName = name.value.slice(colon + 1);
  if (!isNcName(prefix) || !isNcName(localName)) {
    cursor.fail(`Invalid XML qualified name ${JSON.stringify(name.value)}`, name.mark);
  }
  return { lexical: name.value, localName, prefix, mark: name.mark, end: name.end };
};

const validatedOptions = (options: ParseOptions) => {
  const input: unknown = options;
  if (!Predicate.isObject(input)) {
    throw new ParseFailure({ detail: "Parser options must be an object", location: startMark });
  }
  if (options.locations !== undefined && !Predicate.isBoolean(options.locations)) {
    throw new ParseFailure({
      detail: "Parser option locations must be a boolean",
      location: startMark,
    });
  }
  const limits = options.limits;
  const limitsInput: unknown = limits;
  if (limits !== undefined && !Predicate.isObject(limitsInput)) {
    throw new ParseFailure({ detail: "Parser limits must be an object", location: startMark });
  }
  if (limits !== undefined) {
    const entries: ReadonlyArray<readonly [string, number | undefined]> = [
      ["inputLength", limits.inputLength],
      ["depth", limits.depth],
      ["nodes", limits.nodes],
      ["attributesPerElement", limits.attributesPerElement],
      ["textLength", limits.textLength],
    ];
    for (const [name, limit] of entries) {
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
        throw new ParseFailure({
          detail: `Parser limit ${name} must be a non-negative safe integer`,
          location: startMark,
        });
      }
    }
  }
  return options;
};

const hasValidEncodingName = (value: string) => {
  if (value.length === 0) return false;
  const first = value.charCodeAt(0);
  if (!((first >= 0x41 && first <= 0x5a) || (first >= 0x61 && first <= 0x7a))) return false;
  for (let index = 1; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      !(
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        isAsciiDigit(code) ||
        code === 0x2e ||
        code === 0x5f ||
        code === 0x2d
      )
    ) {
      return false;
    }
  }
  return true;
};

const optionalSpan = (enabled: boolean, start: number, end: number) =>
  enabled ? { span: { start, end } } : {};

class Parser {
  readonly cursor: Cursor;
  readonly positions = new WeakMap<Node, XmlLocation>();
  readonly locations: boolean;
  readonly limits: ParserLimits | undefined;
  readonly namespaces = new Map<string, string>([["xml", xmlNamespace]]);
  readonly stack: Array<Frame> = [];
  readonly prolog: Array<Misc> = [];
  readonly epilog: Array<Misc> = [];
  root: Element | undefined;
  declaration: Declaration | undefined;
  nodeCount = 0;
  textLength = 0;

  constructor(chunks: Iterable<string>, options: ParseOptions) {
    this.cursor = new Cursor(chunks, options.limits?.inputLength);
    this.locations = options.locations === true;
    this.limits = options.limits;
  }

  private locate<NodeType extends Node>(node: NodeType, mark: Mark) {
    this.positions.set(node, { start: mark.offset, line: mark.line, column: mark.column });
    return node;
  }

  private countNode(mark: Mark) {
    const limit = this.limits?.nodes;
    if (limit !== undefined && this.nodeCount >= limit) {
      this.cursor.fail(`Parser nodes limit of ${limit} was exceeded`, mark);
    }
    this.nodeCount += 1;
  }

  private reserveText(length: number, mark: Mark) {
    const limit = this.limits?.textLength;
    if (limit !== undefined && length > limit - this.textLength) {
      this.cursor.fail(
        `Parser textLength limit of ${limit} decoded UTF-16 code units was exceeded`,
        mark,
      );
    }
    this.textLength += length;
  }

  private appendLiteral(builder: StringBuilder, attribute: boolean) {
    const cursor = this.cursor;
    const mark = cursor.mark();
    const codePoint = cursor.validCodePoint();
    if (codePoint === 0xd) {
      this.reserveText(1, mark);
      cursor.advance();
      if (cursor.codeUnit() === 0xa) cursor.advance();
      builder.append(attribute ? " " : "\n");
      return;
    }
    const value =
      attribute && (codePoint === 0xa || codePoint === 0x9) ? " " : String.fromCodePoint(codePoint);
    this.reserveText(value.length, mark);
    cursor.advance(codePoint > 0xffff ? 2 : 1);
    builder.append(value);
  }

  private readReference(attributeQuote: number | undefined) {
    const cursor = this.cursor;
    const mark = cursor.mark();
    this.reserveText(1, mark);
    cursor.expect("&", "Expected an entity or character reference");

    let value: string | undefined;
    if (cursor.codeUnit() === 0x23) {
      cursor.advance();
      const hexadecimal = cursor.codeUnit() === 0x78;
      if (hexadecimal) cursor.advance();
      const radix = hexadecimal ? 16 : 10;
      let codePoint = 0;
      let hasDigit = false;
      while (true) {
        const code = cursor.codeUnit();
        if (code === undefined) break;
        const digit = asciiDigitValue(code, hexadecimal);
        if (digit === undefined) break;
        hasDigit = true;
        if (codePoint > Math.floor((0x10ffff - digit) / radix)) {
          cursor.fail("Character reference is not permitted by XML 1.0", mark);
        }
        codePoint = codePoint * radix + digit;
        cursor.advance();
      }
      if (!hasDigit || cursor.codeUnit() !== 0x3b) {
        cursor.fail("Invalid character reference", mark);
      }
      cursor.advance();
      if (!isXml10Char(codePoint)) {
        cursor.fail("Character reference is not permitted by XML 1.0", mark);
      }
      value = String.fromCodePoint(codePoint);
    } else {
      for (const [reference, decoded] of namedReferences) {
        if (cursor.startsWith(reference)) {
          cursor.advance(reference.length);
          value = decoded;
          break;
        }
      }
    }

    if (value !== undefined) {
      this.reserveText(value.length - 1, mark);
      return value;
    }

    let spelling = "&";
    let complete = false;
    for (let offset = 0; offset < 8; offset++) {
      const code = cursor.codeUnit(offset);
      if (
        code === undefined ||
        code < 0x20 ||
        code > 0x7e ||
        code === 0x3c ||
        code === attributeQuote
      ) {
        break;
      }
      spelling += String.fromCharCode(code);
      if (code === 0x3b) {
        complete = true;
        break;
      }
    }
    return cursor.fail(
      `Unknown entity reference ${spelling}${complete ? " " : "…; "}DTD processing is not supported`,
      mark,
    );
  }

  private readDecodedUntil(terminator: string, attribute: boolean) {
    const cursor = this.cursor;
    const builder = new StringBuilder();
    const quote = attribute ? terminator.charCodeAt(0) : undefined;
    while (!cursor.done && !cursor.startsWith(terminator)) {
      if (attribute && cursor.codeUnit() === 0x3c) {
        cursor.fail("Attribute values cannot contain a literal < character");
      }
      if (cursor.codeUnit() === 0x26) builder.append(this.readReference(quote));
      else this.appendLiteral(builder, attribute);
    }
    return builder.finish();
  }

  private readNormalizedUntil(terminator: string) {
    const cursor = this.cursor;
    const builder = new StringBuilder();
    while (!cursor.done && !cursor.startsWith(terminator)) {
      this.appendLiteral(builder, false);
    }
    return builder.finish();
  }

  private readRawQuotedValue() {
    const cursor = this.cursor;
    const quote = cursor.codeUnit();
    if (quote !== 0x22 && quote !== 0x27) cursor.fail("Expected a quoted value");
    cursor.advance();
    const builder = new StringBuilder();
    while (!cursor.done && cursor.codeUnit() !== quote) {
      const codePoint = cursor.validCodePoint();
      builder.append(String.fromCodePoint(codePoint));
      cursor.advance(codePoint > 0xffff ? 2 : 1);
    }
    if (cursor.done) cursor.fail("Unterminated quoted value");
    cursor.advance();
    return builder.finish();
  }

  private parseDeclaration() {
    const cursor = this.cursor;
    const declarationStart = cursor.mark();
    cursor.expect("<?xml", "Expected an XML declaration");
    if (!cursor.skipWhitespace()) {
      cursor.fail("The XML declaration requires version as its first field");
    }

    const readField = () => {
      const name = cursor.readName("an XML declaration field");
      cursor.skipWhitespace();
      cursor.expect("=", `Expected = after XML declaration field ${JSON.stringify(name.value)}`);
      cursor.skipWhitespace();
      const quote = cursor.codeUnit();
      if (quote !== 0x22 && quote !== 0x27) {
        cursor.fail(
          `Expected a quoted value for XML declaration field ${JSON.stringify(name.value)}`,
        );
      }
      const value = this.readRawQuotedValue();
      return { name: name.value, value, mark: name.mark };
    };

    const version = readField();
    if (version.name !== "version") {
      cursor.fail("The XML declaration must begin with the version field", version.mark);
    }
    if (version.value === "1.1") {
      cursor.fail("XML 1.1 is not supported; this parser implements XML 1.0", version.mark);
    }
    if (version.value !== "1.0") {
      cursor.fail("The XML declaration version must be 1.0", version.mark);
    }

    let encoding: string | undefined;
    let standalone: "yes" | "no" | undefined;
    let previousField = "version";
    while (true) {
      const hadWhitespace = cursor.skipWhitespace();
      if (cursor.startsWith("?>")) break;
      if (!hadWhitespace) cursor.fail("XML declaration fields must be separated by whitespace");
      const field = readField();
      if (field.name === "encoding" && previousField === "version") {
        if (!hasValidEncodingName(field.value))
          cursor.fail("Invalid XML encoding name", field.mark);
        encoding = field.value;
        previousField = "encoding";
      } else if (
        field.name === "standalone" &&
        (previousField === "version" || previousField === "encoding")
      ) {
        if (field.value !== "yes" && field.value !== "no") {
          cursor.fail("XML standalone must be either yes or no", field.mark);
        }
        standalone = field.value === "yes" ? "yes" : "no";
        previousField = "standalone";
      } else {
        cursor.fail(
          `Unexpected or out-of-order XML declaration field ${JSON.stringify(field.name)}`,
          field.mark,
        );
      }
    }
    cursor.expect("?>", "Unterminated XML declaration");
    const fields: DeclarationFields = {
      version: "1.0",
      ...optionalSpan(this.locations, declarationStart.offset, cursor.index),
    };
    if (encoding !== undefined) fields.encoding = encoding;
    if (standalone !== undefined) fields.standalone = standalone;
    this.declaration = this.locate(new Declaration(fields), declarationStart);
  }

  private appendMisc(node: Misc) {
    const frame = this.stack.at(-1);
    if (frame !== undefined) frame.children.push(node);
    else if (this.root === undefined) this.prolog.push(node);
    else this.epilog.push(node);
  }

  private parseComment() {
    const cursor = this.cursor;
    const start = cursor.mark();
    this.countNode(start);
    cursor.expect("<!--", "Expected an XML comment");
    const builder = new StringBuilder();
    while (!cursor.done && !cursor.startsWith("-->")) {
      if (cursor.startsWith("--")) cursor.fail("XML comments cannot contain --");
      this.appendLiteral(builder, false);
    }
    if (cursor.done) cursor.fail("Unterminated XML comment", start);
    cursor.expect("-->", "Unterminated XML comment");
    const comment = this.locate(
      new Comment({
        value: builder.finish(),
        ...optionalSpan(this.locations, start.offset, cursor.index),
      }),
      start,
    );
    this.appendMisc(comment);
  }

  private parseCData() {
    const cursor = this.cursor;
    const possibleFrame = this.stack.at(-1);
    const start = cursor.mark();
    const frame =
      possibleFrame ?? cursor.fail("CDATA sections are only allowed inside an element", start);
    this.countNode(start);
    cursor.expect("<![CDATA[", "Expected a CDATA section");
    const value = this.readNormalizedUntil("]]>");
    if (cursor.done) cursor.fail("Unterminated CDATA section", start);
    cursor.expect("]]>", "Unterminated CDATA section");
    frame.children.push(
      this.locate(
        new CData({ value, ...optionalSpan(this.locations, start.offset, cursor.index) }),
        start,
      ),
    );
  }

  private parseProcessingInstruction() {
    const cursor = this.cursor;
    const start = cursor.mark();
    this.countNode(start);
    cursor.expect("<?", "Expected a processing instruction");
    const target = cursor.readName("a processing-instruction target");
    if (!isNcName(target.value)) {
      cursor.fail(
        `Invalid processing-instruction target ${JSON.stringify(target.value)}`,
        target.mark,
      );
    }
    if (target.value.toLowerCase() === "xml") {
      cursor.fail("The processing-instruction target xml is reserved", target.mark);
    }
    let hasData = false;
    if (!cursor.startsWith("?>")) {
      if (!cursor.skipWhitespace()) {
        cursor.fail("Processing-instruction data must be separated from its target by whitespace");
      }
      hasData = true;
    }
    const value = hasData ? this.readNormalizedUntil("?>") : "";
    if (cursor.done) cursor.fail("Unterminated processing instruction", start);
    cursor.expect("?>", "Unterminated processing instruction");
    const instruction = this.locate(
      new ProcessingInstruction({
        target: target.value,
        value,
        ...optionalSpan(this.locations, start.offset, cursor.index),
      }),
      start,
    );
    this.appendMisc(instruction);
  }

  private parseAttribute() {
    const cursor = this.cursor;
    const mark = cursor.mark();
    const name = splitQualifiedName(cursor, cursor.readName("an attribute name"));
    cursor.skipWhitespace();
    cursor.expect("=", `Expected = after attribute ${JSON.stringify(name.lexical)}`);
    cursor.skipWhitespace();
    const quote = cursor.codeUnit();
    if (quote !== 0x22 && quote !== 0x27) {
      cursor.fail(`Expected a quoted value for attribute ${JSON.stringify(name.lexical)}`);
    }
    cursor.advance();
    const value = this.readDecodedUntil(quote === 0x22 ? '"' : "'", true);
    if (cursor.done)
      cursor.fail(`Unterminated value for attribute ${JSON.stringify(name.lexical)}`, mark);
    cursor.advance();
    return { name, value, mark, end: cursor.index };
  }

  private resolveName(qualified: QualifiedName, attribute: boolean) {
    if (qualified.prefix === "xmlns") {
      this.cursor.fail("The xmlns prefix is reserved for namespace declarations", qualified.mark);
    }
    let namespaceUri: string | undefined;
    if (qualified.prefix !== undefined) namespaceUri = this.namespaces.get(qualified.prefix);
    else if (!attribute) namespaceUri = this.namespaces.get("");
    if (qualified.prefix !== undefined && namespaceUri === undefined) {
      this.cursor.fail(
        `Unbound namespace prefix ${JSON.stringify(qualified.prefix)}`,
        qualified.mark,
      );
    }
    const fields: NameFields = {
      localName: qualified.localName,
      ...optionalSpan(this.locations, qualified.mark.offset, qualified.end),
    };
    if (qualified.prefix !== undefined) fields.prefix = qualified.prefix;
    if (namespaceUri !== undefined) fields.namespaceUri = namespaceUri;
    return this.locate(new Name(fields), qualified.mark);
  }

  private applyNamespaceDeclaration(raw: RawAttribute, changes: Array<NamespaceChange>) {
    const prefix = raw.name.prefix === "xmlns" ? raw.name.localName : undefined;
    const message = validateBinding(prefix, raw.value);
    if (message !== undefined) this.cursor.fail(message, raw.mark);
    const key = prefix ?? "";
    changes.push({
      prefix: key,
      hadPrevious: this.namespaces.has(key),
      previous: this.namespaces.get(key),
    });
    if (raw.value.length === 0) this.namespaces.delete(key);
    else this.namespaces.set(key, raw.value);
    const fields: NamespaceDeclarationFields = {
      namespaceUri: raw.value,
      ...optionalSpan(this.locations, raw.mark.offset, raw.end),
    };
    if (prefix !== undefined) fields.prefix = prefix;
    return this.locate(new NamespaceDeclaration(fields), raw.mark);
  }

  private restoreNamespaces(changes: ReadonlyArray<NamespaceChange>) {
    for (let index = changes.length - 1; index >= 0; index--) {
      const change = changes[index];
      if (change === undefined) continue;
      if (change.hadPrevious && change.previous !== undefined) {
        this.namespaces.set(change.prefix, change.previous);
      } else {
        this.namespaces.delete(change.prefix);
      }
    }
  }

  private finishFrame(frame: Frame, end: number) {
    const element = this.locate(
      new Element({
        name: frame.name,
        namespaceDeclarations: frame.namespaceDeclarations,
        attributes: frame.attributes,
        children: frame.children,
        ...optionalSpan(this.locations, frame.start.offset, end),
      }),
      frame.start,
    );
    this.restoreNamespaces(frame.namespaceChanges);
    const parent = this.stack.at(-1);
    if (parent !== undefined) parent.children.push(element);
    else if (this.root === undefined) this.root = element;
    else this.cursor.fail("An XML document must contain exactly one root element", frame.start);
  }

  private parseStartTag() {
    const cursor = this.cursor;
    const start = cursor.mark();
    if (this.stack.length === 0 && this.root !== undefined) {
      cursor.fail("An XML document must contain exactly one root element", start);
    }
    const depth = this.stack.length + 1;
    const depthLimit = this.limits?.depth;
    if (depthLimit !== undefined && depth > depthLimit) {
      cursor.fail(`Parser depth limit of ${depthLimit} was exceeded`, start);
    }
    this.countNode(start);
    cursor.expect("<", "Expected an element start tag");
    const qualified = splitQualifiedName(cursor, cursor.readName("an element name"));
    const rawAttributes: Array<RawAttribute> = [];
    const lexicalNames = new Set<string>();
    let selfClosing = false;
    while (true) {
      const separated = cursor.skipWhitespace();
      if (cursor.startsWith("/>")) {
        cursor.advance(2);
        selfClosing = true;
        break;
      }
      if (cursor.startsWith(">")) {
        cursor.advance();
        break;
      }
      if (!separated) {
        cursor.fail(
          "Attributes must be separated from the element name or each other by whitespace",
        );
      }
      const limit = this.limits?.attributesPerElement;
      if (limit !== undefined && rawAttributes.length >= limit) {
        cursor.fail(`Parser attributesPerElement limit of ${limit} was exceeded`, cursor.mark());
      }
      const raw = this.parseAttribute();
      if (lexicalNames.has(raw.name.lexical)) {
        cursor.fail(`Duplicate attribute ${JSON.stringify(raw.name.lexical)}`, raw.mark);
      }
      lexicalNames.add(raw.name.lexical);
      rawAttributes.push(raw);
    }

    const namespaceChanges: Array<NamespaceChange> = [];
    const namespaceDeclarations: Array<NamespaceDeclaration> = [];
    for (const raw of rawAttributes) {
      if (raw.name.lexical === "xmlns" || raw.name.prefix === "xmlns") {
        namespaceDeclarations.push(this.applyNamespaceDeclaration(raw, namespaceChanges));
      }
    }

    const name = this.resolveName(qualified, false);
    const attributes: Array<Attribute> = [];
    const expandedNames = new Set<string>();
    for (const raw of rawAttributes) {
      if (raw.name.lexical === "xmlns" || raw.name.prefix === "xmlns") continue;
      const attributeName = this.resolveName(raw.name, true);
      const expandedName = `${attributeName.namespaceUri ?? ""}\u0000${attributeName.localName}`;
      if (expandedNames.has(expandedName)) {
        cursor.fail(
          `Duplicate attribute expanded name {${attributeName.namespaceUri ?? ""}}${attributeName.localName}`,
          raw.mark,
        );
      }
      expandedNames.add(expandedName);
      attributes.push(
        this.locate(
          new Attribute({
            name: attributeName,
            value: raw.value,
            ...optionalSpan(this.locations, raw.mark.offset, raw.end),
          }),
          raw.mark,
        ),
      );
    }

    const frame: Frame = {
      lexicalName: qualified.lexical,
      name,
      namespaceDeclarations,
      attributes,
      children: [],
      namespaceChanges,
      start,
    };
    if (selfClosing) this.finishFrame(frame, cursor.index);
    else this.stack.push(frame);
  }

  private parseEndTag() {
    const cursor = this.cursor;
    const start = cursor.mark();
    cursor.expect("</", "Expected an element end tag");
    const qualified = splitQualifiedName(cursor, cursor.readName("an element end name"));
    cursor.skipWhitespace();
    cursor.expect(">", "Expected > after the element end name");
    const frame = this.stack.pop() ?? cursor.fail("Unexpected element end tag", start);
    if (qualified.lexical !== frame.lexicalName) {
      cursor.fail(
        `Mismatched closing tag: expected </${frame.lexicalName}>, found </${qualified.lexical}>`,
        start,
      );
    }
    this.finishFrame(frame, cursor.index);
  }

  private parseText() {
    const cursor = this.cursor;
    const start = cursor.mark();
    if (this.stack.length === 0) {
      while (!cursor.done && !cursor.startsWith("<")) {
        const codePoint = cursor.validCodePoint();
        if (!isXmlWhitespaceCode(codePoint)) {
          cursor.fail("Character data is not allowed outside the document root");
        }
        cursor.advance();
      }
      return;
    }
    this.countNode(start);
    const builder = new StringBuilder();
    while (!cursor.done && !cursor.startsWith("<")) {
      if (cursor.codeUnit() === 0x5d && cursor.startsWith("]]>")) {
        cursor.fail("Character data cannot contain the CDATA closing delimiter ]]>");
      }
      if (cursor.codeUnit() === 0x26) builder.append(this.readReference(undefined));
      else this.appendLiteral(builder, false);
    }
    this.stack.at(-1)?.children.push(
      this.locate(
        new Text({
          value: builder.finish(),
          ...optionalSpan(this.locations, start.offset, cursor.index),
        }),
        start,
      ),
    );
  }

  parse() {
    const cursor = this.cursor;
    if (cursor.codeUnit() === 0xfeff) cursor.advance();
    if (
      cursor.codeUnit() === 0x3c &&
      cursor.codeUnit(1) === 0x3f &&
      cursor.startsWith("<?xml") &&
      (isXmlWhitespaceCode(cursor.codeUnit(5)) || cursor.startsWith("<?xml?>"))
    ) {
      this.parseDeclaration();
    }

    while (!cursor.done) {
      if (cursor.codeUnit() !== 0x3c) {
        this.parseText();
        continue;
      }
      const next = cursor.codeUnit(1);
      if (next === 0x21) {
        if (cursor.startsWith("<!--")) this.parseComment();
        else if (cursor.startsWith("<![CDATA[")) this.parseCData();
        else if (cursor.startsWith("<!DOCTYPE")) cursor.fail("DTD processing is not supported");
        else cursor.fail("Unsupported XML markup declaration");
      } else if (next === 0x3f) this.parseProcessingInstruction();
      else if (next === 0x2f) this.parseEndTag();
      else this.parseStartTag();
    }

    const open = this.stack.at(-1);
    if (open !== undefined) cursor.fail(`Unclosed element <${open.lexicalName}>`, cursor.mark());
    const root = this.root ?? cursor.fail("XML document has no root element", cursor.mark());
    const fields: DocumentFields = {
      prolog: this.prolog,
      root,
      epilog: this.epilog,
      ...optionalSpan(this.locations, 0, cursor.index),
    };
    if (this.declaration !== undefined) fields.declaration = this.declaration;
    const document = this.locate(new Document(fields), startMark);
    return { document, positions: this.positions };
  }
}

/** @internal Chunk-boundary-independent parser entry used by the string facade. */
export const parseDocumentChunks = (chunks: Iterable<string>, options: ParseOptions = {}) => {
  try {
    const checkedOptions = validatedOptions(options);
    return Result.succeed(new Parser(chunks, checkedOptions).parse());
  } catch (cause) {
    if (Predicate.isTagged(cause, "ParseFailure") && cause instanceof ParseFailure) {
      return Result.fail(makeIssue(cause));
    }
    throw cause;
  }
};
