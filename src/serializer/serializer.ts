import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaParser from "effect/SchemaParser";

import { Attribute } from "../ast/attribute.ts";
import { Comment, isComment } from "../ast/comment.ts";
import { Declaration } from "../ast/declaration.ts";
import { Document, type Misc } from "../ast/document.ts";
import { Element, isElement, type Child } from "../ast/element.ts";
import { Fragment as AstFragment } from "../ast/fragment.ts";
import { Name } from "../ast/name.ts";
import { NamespaceDeclaration } from "../ast/namespace-declaration.ts";
import { isProcessingInstruction, ProcessingInstruction } from "../ast/processing-instruction.ts";
import { CData, isCData, isText, Text } from "../ast/text.ts";
import { NamespaceContext } from "../namespace/context.ts";
import { ActiveNamespaces, type NamespaceUndo } from "../namespace/prefix.ts";
import { validateBinding, xmlNamespace, xmlnsNamespace } from "../namespace/validation.ts";
import { isNcName, isXml11RestrictedChar, isXmlChar } from "../parser/character.ts";

export type XmlVersion = "1.0" | "1.1";

/** Options used by the low-level XML serializer. */
export interface SerializeOptions {
  readonly pretty?: boolean;
  readonly indent?: string;
  /** Elements whose typed content model permits inserted formatting whitespace. */
  readonly structured?: WeakSet<Element>;
  /** @internal Elements produced by typed codecs whose namespace prefixes may be allocated. */
  readonly typed?: WeakSet<Element>;
  /** @internal Raw Rest attributes whose parsed prefixes must remain fixed on typed owners. */
  readonly rawAttributes?: WeakSet<Attribute>;
  /** @internal Effective Rest scopes restored before allocating typed names on their owners. */
  readonly restNamespaces?: WeakMap<Element, NamespaceContext>;
}

/** Options used when serializing an ordered XML fragment. */
export interface FragmentSerializeOptions extends SerializeOptions {
  readonly version?: XmlVersion;
  readonly namespaces?: NamespaceContext;
}

interface NodeAction {
  readonly node: Child | Misc;
  readonly preserveSpace: boolean;
  readonly depth: number;
}

interface OutputAction {
  readonly output: string;
}

interface NamespaceExitAction {
  readonly namespaceUndo: ReadonlyArray<NamespaceUndo>;
}

type Action = NodeAction | OutputAction | NamespaceExitAction;

const decodeNamespaceContext = SchemaParser.decodeUnknownResult(NamespaceContext);

const invalid = (message: string) => new SchemaIssue.InvalidValue({ message });

const failure = (message: string) => Result.fail<SchemaIssue.Issue>(invalid(message));

/**
 * Fast validation covers the AST schemas' storage rules only. The writer below
 * remains responsible for XML grammar, characters, and namespace semantics.
 */
interface SpanValue {
  readonly start: number;
  readonly end: number;
}

const validateSpan = (span: SpanValue | undefined, context: string) => {
  const input: unknown = span;
  if (
    !Predicate.isObject(input) ||
    !Predicate.hasProperty(input, "start") ||
    !Predicate.isNumber(input.start) ||
    !Number.isSafeInteger(input.start) ||
    input.start < 0 ||
    !Predicate.hasProperty(input, "end") ||
    !Predicate.isNumber(input.end) ||
    !Number.isSafeInteger(input.end) ||
    input.end < 0
  ) {
    return invalid(`${context} span must contain nonnegative safe-integer start and end offsets`);
  }
  if (input.end < input.start) return invalid(`${context} span end must not precede start`);
  return undefined;
};

type SpanOwner =
  | Attribute
  | CData
  | Comment
  | Declaration
  | Document
  | Element
  | AstFragment
  | Name
  | NamespaceDeclaration
  | ProcessingInstruction
  | Text;

const validateOptionalSpan = (value: SpanOwner, span: SpanValue | undefined, context: string) =>
  Predicate.hasProperty(value, "span") ? validateSpan(span, context) : undefined;

const validateNameStructure = (name: Name, context: string) => {
  if (!(name instanceof Name) || !Predicate.isTagged(name, "Name")) {
    return invalid(`${context} name must be a Name node`);
  }
  if (!Predicate.isString(name.localName)) return invalid(`${context} local name must be a string`);
  if (Predicate.hasProperty(name, "namespaceUri") && !Predicate.isString(name.namespaceUri)) {
    return invalid(`${context} namespace URI must be a string when present`);
  }
  if (Predicate.hasProperty(name, "prefix") && !Predicate.isString(name.prefix)) {
    return invalid(`${context} prefix must be a string when present`);
  }
  return validateOptionalSpan(name, name.span, `${context} name`);
};

const validateNamespaceDeclarationStructure = (declaration: NamespaceDeclaration) => {
  if (
    !(declaration instanceof NamespaceDeclaration) ||
    !Predicate.isTagged(declaration, "NamespaceDeclaration")
  ) {
    return invalid("Element namespace declarations must be NamespaceDeclaration nodes");
  }
  if (Predicate.hasProperty(declaration, "prefix") && !Predicate.isString(declaration.prefix)) {
    return invalid("Namespace declaration prefix must be a string when present");
  }
  if (!Predicate.isString(declaration.namespaceUri)) {
    return invalid("Namespace declaration URI must be a string");
  }
  return validateOptionalSpan(declaration, declaration.span, "Namespace declaration");
};

const validateAttributeStructure = (attribute: Attribute) => {
  if (!(attribute instanceof Attribute) || !Predicate.isTagged(attribute, "Attribute")) {
    return invalid("Element attributes must be Attribute nodes");
  }
  const nameIssue = validateNameStructure(attribute.name, "Attribute");
  if (nameIssue !== undefined) return nameIssue;
  if (!Predicate.isString(attribute.value)) return invalid("Attribute value must be a string");
  return validateOptionalSpan(attribute, attribute.span, "Attribute");
};

const validateValueNodeStructure = (
  node: Text | CData | Comment,
  tag: "Text" | "CData" | "Comment",
  label: string,
) => {
  if (!Predicate.isTagged(node, tag)) return invalid(`${label} node tag is invalid`);
  if (!Predicate.isString(node.value)) return invalid(`${label} value must be a string`);
  return validateOptionalSpan(node, node.span, label);
};

const validateProcessingInstructionStructure = (instruction: ProcessingInstruction) => {
  if (!Predicate.isTagged(instruction, "ProcessingInstruction")) {
    return invalid("Processing instruction node tag is invalid");
  }
  if (!Predicate.isString(instruction.target)) {
    return invalid("Processing instruction target must be a string");
  }
  if (!Predicate.isString(instruction.value)) {
    return invalid("Processing instruction value must be a string");
  }
  return validateOptionalSpan(instruction, instruction.span, "Processing instruction");
};

const validateMiscStructure = (node: Misc) => {
  if (node instanceof Comment) return validateValueNodeStructure(node, "Comment", "Comment");
  if (node instanceof ProcessingInstruction) return validateProcessingInstructionStructure(node);
  return invalid(
    "Document prolog and epilog entries must be Comment or ProcessingInstruction nodes",
  );
};

interface NodeVisit {
  readonly kind: "node";
  readonly node: Child;
}

interface ElementExit {
  readonly kind: "exit";
  readonly element: Element;
}

type StructureAction = NodeVisit | ElementExit;

/** Validates recursive content without constructing replacement nodes or using the JS call stack. */
const validateChildrenStructure = (children: ReadonlyArray<Child>) => {
  const actions: Array<StructureAction> = [];
  for (let index = children.length - 1; index >= 0; index--) {
    actions.push({ kind: "node", node: children[index]! });
  }

  const states = new WeakMap<Element, "active" | "complete">();
  while (actions.length > 0) {
    const action = actions.pop()!;
    if (action.kind === "exit") {
      states.set(action.element, "complete");
      continue;
    }

    const node = action.node;
    if (node instanceof Text) {
      const issue = validateValueNodeStructure(node, "Text", "Text");
      if (issue !== undefined) return issue;
      continue;
    }
    if (node instanceof CData) {
      const issue = validateValueNodeStructure(node, "CData", "CDATA");
      if (issue !== undefined) return issue;
      continue;
    }
    if (node instanceof Comment) {
      const issue = validateValueNodeStructure(node, "Comment", "Comment");
      if (issue !== undefined) return issue;
      continue;
    }
    if (node instanceof ProcessingInstruction) {
      const issue = validateProcessingInstructionStructure(node);
      if (issue !== undefined) return issue;
      continue;
    }
    if (!(node instanceof Element) || !Predicate.isTagged(node, "Element")) {
      return invalid("Element children must be XML child nodes");
    }

    const state = states.get(node);
    if (state === "active") return invalid("XML element content contains a cycle");
    if (state === "complete") continue;

    const nameIssue = validateNameStructure(node.name, "Element");
    if (nameIssue !== undefined) return nameIssue;
    const spanIssue = validateOptionalSpan(node, node.span, "Element");
    if (spanIssue !== undefined) return spanIssue;
    if (!Array.isArray(node.namespaceDeclarations)) {
      return invalid("Element namespaceDeclarations must be an array");
    }
    for (const declaration of node.namespaceDeclarations) {
      const issue = validateNamespaceDeclarationStructure(declaration);
      if (issue !== undefined) return issue;
    }
    if (!Array.isArray(node.attributes)) return invalid("Element attributes must be an array");
    for (const attribute of node.attributes) {
      const issue = validateAttributeStructure(attribute);
      if (issue !== undefined) return issue;
    }
    if (!Array.isArray(node.children)) return invalid("Element children must be an array");

    states.set(node, "active");
    actions.push({ kind: "exit", element: node });
    for (let index = node.children.length - 1; index >= 0; index--) {
      actions.push({ kind: "node", node: node.children[index]! });
    }
  }
  return undefined;
};

const validateDeclarationStructure = (declaration: Declaration) => {
  if (!(declaration instanceof Declaration) || !Predicate.isTagged(declaration, "Declaration")) {
    return invalid("Document declaration must be a Declaration node");
  }
  if (declaration.version !== "1.0" && declaration.version !== "1.1") {
    return invalid('XML declaration version must be "1.0" or "1.1"');
  }
  if (Predicate.hasProperty(declaration, "encoding") && !Predicate.isString(declaration.encoding)) {
    return invalid("XML declaration encoding must be a string when present");
  }
  if (
    Predicate.hasProperty(declaration, "standalone") &&
    declaration.standalone !== "yes" &&
    declaration.standalone !== "no"
  ) {
    return invalid('XML declaration standalone must be "yes" or "no" when present');
  }
  return validateOptionalSpan(declaration, declaration.span, "XML declaration");
};

const validateDocumentStructure = (document: Document) => {
  try {
    if (!(document instanceof Document) || !Predicate.isTagged(document, "Document")) {
      return invalid("Invalid XML document");
    }
    if (Predicate.hasProperty(document, "declaration")) {
      const issue = validateDeclarationStructure(document.declaration!);
      if (issue !== undefined) return issue;
    }
    if (!Array.isArray(document.prolog)) return invalid("Document prolog must be an array");
    for (const node of document.prolog) {
      const issue = validateMiscStructure(node);
      if (issue !== undefined) return issue;
    }
    if (!(document.root instanceof Element))
      return invalid("Document root must be an Element node");
    if (!Array.isArray(document.epilog)) return invalid("Document epilog must be an array");
    for (const node of document.epilog) {
      const issue = validateMiscStructure(node);
      if (issue !== undefined) return issue;
    }
    const spanIssue = validateOptionalSpan(document, document.span, "Document");
    if (spanIssue !== undefined) return spanIssue;
    return validateChildrenStructure([document.root]);
  } catch {
    return invalid("Invalid XML document");
  }
};

const validateFragmentStructure = (fragment: AstFragment) => {
  try {
    if (!(fragment instanceof AstFragment) || !Predicate.isTagged(fragment, "Fragment")) {
      return invalid("Invalid XML fragment");
    }
    if (!Array.isArray(fragment.children)) return invalid("Fragment children must be an array");
    const spanIssue = validateOptionalSpan(fragment, fragment.span, "Fragment");
    if (spanIssue !== undefined) return spanIssue;
    return validateChildrenStructure(fragment.children);
  } catch {
    return invalid("Invalid XML fragment");
  }
};

const codePointLabel = (codePoint: number) =>
  `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;

const invalidCharacter = (value: string, context: string, version: XmlVersion) => {
  let offset = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || !isXmlChar(codePoint, version)) {
      return invalid(
        `${context} contains an invalid XML ${version} character ${codePointLabel(codePoint ?? 0)} at UTF-16 offset ${offset}`,
      );
    }
    offset += character.length;
  }
  return undefined;
};

const characterReference = (codePoint: number) => `&#x${codePoint.toString(16).toUpperCase()};`;

const xml11NeedsReference = (codePoint: number) =>
  isXml11RestrictedChar(codePoint) || codePoint === 0x85 || codePoint === 0x2028;

const escapeText = (value: string, version: XmlVersion) => {
  const output: Array<string> = [];
  let offset = 0;
  let literalStart = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (!isXmlChar(codePoint, version)) {
      return Result.fail(
        invalid(
          `Text contains an invalid XML ${version} character ${codePointLabel(codePoint)} at UTF-16 offset ${offset}`,
        ),
      );
    }
    let replacement: string | undefined;
    if (character === "&") replacement = "&amp;";
    else if (character === "<") replacement = "&lt;";
    else if (character === ">") replacement = "&gt;";
    else if (codePoint === 0x0d || (version === "1.1" && xml11NeedsReference(codePoint))) {
      replacement = characterReference(codePoint);
    }
    if (replacement !== undefined) {
      output.push(value.slice(literalStart, offset), replacement);
      literalStart = offset + character.length;
    }
    offset += character.length;
  }
  output.push(value.slice(literalStart));
  return Result.succeed(output.join(""));
};

const escapeAttribute = (value: string, context: string, version: XmlVersion) => {
  const output: Array<string> = [];
  let offset = 0;
  let literalStart = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (!isXmlChar(codePoint, version)) {
      return Result.fail(
        invalid(
          `${context} contains an invalid XML ${version} character ${codePointLabel(codePoint)} at UTF-16 offset ${offset}`,
        ),
      );
    }
    let replacement: string | undefined;
    if (character === "&") replacement = "&amp;";
    else if (character === "<") replacement = "&lt;";
    else if (character === '"') replacement = "&quot;";
    else if (
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (version === "1.1" && xml11NeedsReference(codePoint))
    ) {
      replacement = characterReference(codePoint);
    }
    if (replacement !== undefined) {
      output.push(value.slice(literalStart, offset), replacement);
      literalStart = offset + character.length;
    }
    offset += character.length;
  }
  output.push(value.slice(literalStart));
  return Result.succeed(output.join(""));
};

const validateLiteral = (value: string, context: string, version: XmlVersion) => {
  let literalIssue: SchemaIssue.Issue | undefined;
  let offset = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (!isXmlChar(codePoint, version)) {
      return invalid(
        `${context} contains an invalid XML ${version} character ${codePointLabel(codePoint)} at UTF-16 offset ${offset}`,
      );
    }
    if (literalIssue === undefined) {
      if (version === "1.1" && isXml11RestrictedChar(codePoint)) {
        literalIssue = invalid(
          `${context} contains restricted XML 1.1 character ${codePointLabel(codePoint)} at UTF-16 offset ${offset}, which cannot be represented literally`,
        );
      } else if (
        codePoint === 0x0d ||
        (version === "1.1" && (codePoint === 0x85 || codePoint === 0x2028))
      ) {
        literalIssue = invalid(
          `${context} contains normalization-sensitive literal character ${codePointLabel(codePoint)} at UTF-16 offset ${offset}`,
        );
      }
    }
    offset += character.length;
  }
  return literalIssue;
};

const qualifiedName = (name: Name) =>
  name.prefix === undefined ? name.localName : `${name.prefix}:${name.localName}`;

const validateName = (name: Name, context: string) => {
  if (!isNcName(name.localName)) {
    return invalid(`${context} local name ${JSON.stringify(name.localName)} is not an XML NCName`);
  }
  if (name.prefix !== undefined && !isNcName(name.prefix)) {
    return invalid(`${context} prefix ${JSON.stringify(name.prefix)} is not an XML NCName`);
  }
  if (name.namespaceUri === "") {
    return invalid(`${context} has an empty namespace URI; omit namespaceUri for no namespace`);
  }
  return undefined;
};

const validateBoundName = (name: Name, bindings: ActiveNamespaces, attribute: boolean) => {
  const nameIssue = validateName(name, attribute ? "Attribute" : "Element");
  if (nameIssue !== undefined) return nameIssue;

  if (
    attribute &&
    (name.prefix === "xmlns" ||
      name.namespaceUri === xmlnsNamespace ||
      (name.prefix === undefined && name.localName === "xmlns"))
  ) {
    return invalid("Namespace declarations must not occur in the normal attribute array");
  }

  if (name.prefix === undefined) {
    if (attribute) {
      return name.namespaceUri === undefined
        ? undefined
        : invalid(
            `Unprefixed attribute ${JSON.stringify(name.localName)} cannot use namespace ${JSON.stringify(name.namespaceUri)}`,
          );
    }
    const defaultNamespace = bindings.lookup(undefined);
    const resolved = defaultNamespace === "" ? undefined : defaultNamespace;
    return resolved === name.namespaceUri
      ? undefined
      : invalid(
          `Element ${JSON.stringify(qualifiedName(name))} resolves to ${JSON.stringify(resolved)} instead of ${JSON.stringify(name.namespaceUri)}`,
        );
  }

  if (name.namespaceUri === undefined) {
    return invalid(
      `${attribute ? "Attribute" : "Element"} ${JSON.stringify(qualifiedName(name))} has a prefix but no namespace URI`,
    );
  }
  const resolved = bindings.resolve(name.prefix);
  return resolved === name.namespaceUri
    ? undefined
    : invalid(
        `${attribute ? "Attribute" : "Element"} ${JSON.stringify(qualifiedName(name))} has an unbound or mismatched prefix`,
      );
};

const enterNamespaceScope = (
  declarations: ReadonlyArray<NamespaceDeclaration>,
  bindings: ActiveNamespaces,
  typed: boolean,
  version: XmlVersion,
  fixedPrefixes?: ReadonlySet<string | undefined>,
) => {
  const declared = new Map<string | undefined, string>();
  const emitted: Array<NamespaceDeclaration> = [];
  const undo: Array<NamespaceUndo> = [];
  for (const declaration of declarations) {
    if (declared.has(declaration.prefix)) {
      return failure(
        `Namespace prefix ${JSON.stringify(declaration.prefix)} is declared more than once on one element`,
      );
    }
    declared.set(declaration.prefix, declaration.namespaceUri);
    const bindingIssue = validateBinding(declaration.prefix, declaration.namespaceUri, version);
    if (bindingIssue !== undefined) return failure(bindingIssue);

    const current = bindings.lookup(declaration.prefix);
    const redundant =
      typed &&
      fixedPrefixes?.has(declaration.prefix) !== true &&
      (current === declaration.namespaceUri ||
        (declaration.namespaceUri === "" && current === undefined));
    if (redundant) continue;
    emitted.push(declaration);
    undo.push(bindings.enter(declaration.prefix, declaration.namespaceUri));
  }
  return Result.succeed<
    readonly [
      ReadonlyArray<NamespaceDeclaration>,
      ReadonlyArray<NamespaceUndo>,
      ReadonlyMap<string | undefined, string>,
    ]
  >([emitted, undo, declared]);
};

const exitNamespaceScope = (undo: ReadonlyArray<NamespaceUndo>, bindings: ActiveNamespaces) => {
  for (let index = undo.length - 1; index >= 0; index--) bindings.exit(undo[index]!);
};

const xmlSpace = (element: Element, inherited: boolean) => {
  for (const attribute of element.attributes) {
    if (attribute.name.namespaceUri === xmlNamespace && attribute.name.localName === "space") {
      if (attribute.value === "preserve") return true;
      if (attribute.value === "default") return false;
    }
  }
  return inherited;
};

const canFormatChildren = (
  element: Element,
  pretty: boolean,
  structured: WeakSet<Element> | undefined,
  preserveSpace: boolean,
) =>
  pretty &&
  !preserveSpace &&
  structured?.has(element) === true &&
  element.children.length > 0 &&
  element.children.every((child) => !isText(child) && !isCData(child));

const serializeDeclaration = (document: Document) => {
  const declaration = document.declaration;
  if (declaration === undefined) return Result.succeed("");
  if (
    declaration.encoding !== undefined &&
    !/^[A-Za-z][A-Za-z0-9._-]*$/u.test(declaration.encoding)
  ) {
    return failure(`XML declaration encoding ${JSON.stringify(declaration.encoding)} is invalid`);
  }

  let output = `<?xml version="${declaration.version}"`;
  if (declaration.encoding !== undefined) output += ` encoding="${declaration.encoding}"`;
  if (declaration.standalone !== undefined) output += ` standalone="${declaration.standalone}"`;
  return Result.succeed(`${output}?>`);
};

interface RenderedDeclaration {
  readonly prefix: string | undefined;
  readonly namespaceUri: string;
}

const restoreRestNamespaceDeclarations = (
  declarations: ReadonlyArray<NamespaceDeclaration>,
  context: NamespaceContext,
  bindings: ActiveNamespaces,
  version: XmlVersion,
) => {
  const desired = new Map<string | undefined, string>();
  for (const binding of context.bindings) {
    if (binding.prefix !== "xml") desired.set(binding.prefix, binding.namespaceUri);
  }

  const explicit = new Map<string | undefined, NamespaceDeclaration>();
  for (const declaration of declarations) {
    if (explicit.has(declaration.prefix)) {
      return failure(
        `Namespace prefix ${JSON.stringify(declaration.prefix)} is declared more than once on one element`,
      );
    }
    const bindingIssue = validateBinding(declaration.prefix, declaration.namespaceUri, version);
    if (bindingIssue !== undefined) return failure(bindingIssue);
    const characterIssue = invalidCharacter(declaration.namespaceUri, "Namespace URI", version);
    if (characterIssue !== undefined) return Result.fail(characterIssue);

    explicit.set(declaration.prefix, declaration);
    if (declaration.prefix === "xml") continue;
    const expected = desired.get(declaration.prefix);
    const restoresAbsence = expected === undefined && declaration.namespaceUri === "";
    if (expected !== declaration.namespaceUri && !restoresAbsence) {
      return failure(
        `Namespace prefix ${JSON.stringify(declaration.prefix)} conflicts with the effective Rest namespace snapshot`,
      );
    }
  }

  const restored: Array<NamespaceDeclaration> = [];
  const fixedPrefixes = new Set<string | undefined>();
  const append = (prefix: string | undefined, namespaceUri: string) => {
    fixedPrefixes.add(prefix);
    const declaration = explicit.get(prefix);
    restored.push(
      declaration ??
        (prefix === undefined
          ? new NamespaceDeclaration({ namespaceUri })
          : new NamespaceDeclaration({ prefix, namespaceUri })),
    );
  };

  // Emit the complete desired snapshot in its captured order. Besides fixing QName
  // bindings, this keeps a later snapshot independent of an ancestor's binding order.
  for (const [prefix, namespaceUri] of desired) append(prefix, namespaceUri);

  const appendAbsence = (prefix: string | undefined) => {
    if (prefix !== undefined && version === "1.0") {
      return failure(
        `Cannot restore the effective Rest namespace snapshot in XML 1.0 because inherited prefix ${JSON.stringify(prefix)} must be undeclared`,
      );
    }
    append(prefix, "");
    return undefined;
  };
  if (!desired.has(undefined)) {
    const activeDefault = bindings.lookup(undefined);
    if (activeDefault !== undefined && activeDefault !== "") appendAbsence(undefined);
    else fixedPrefixes.add(undefined);
  }
  for (const prefix of bindings.prefixes()) {
    if (
      prefix !== undefined &&
      prefix !== "xml" &&
      !desired.has(prefix) &&
      bindings.resolve(prefix) !== undefined
    ) {
      const absenceIssue = appendAbsence(prefix);
      if (absenceIssue !== undefined) return absenceIssue;
    }
  }
  return Result.succeed<
    readonly [ReadonlyArray<NamespaceDeclaration>, ReadonlySet<string | undefined>]
  >([restored, fixedPrefixes]);
};

const validateTypedName = (name: Name, attribute: boolean, version: XmlVersion) => {
  const nameIssue = validateName(name, attribute ? "Attribute" : "Element");
  if (nameIssue !== undefined) return nameIssue;

  if (
    attribute &&
    (name.prefix === "xmlns" ||
      name.namespaceUri === xmlnsNamespace ||
      (name.prefix === undefined && name.localName === "xmlns"))
  ) {
    return invalid("Namespace declarations must not occur in the normal attribute array");
  }
  if (name.namespaceUri === xmlnsNamespace) {
    return invalid("The xmlns namespace name is reserved");
  }
  if (name.prefix === undefined) return undefined;
  if (name.namespaceUri === undefined) {
    return invalid(
      `${attribute ? "Attribute" : "Element"} ${JSON.stringify(qualifiedName(name))} has a prefix but no namespace URI`,
    );
  }
  const bindingIssue = validateBinding(name.prefix, name.namespaceUri, version);
  return bindingIssue === undefined ? undefined : invalid(bindingIssue);
};

const allocateTypedName = (
  name: Name,
  attribute: boolean,
  bindings: ActiveNamespaces,
  explicitBindings: ReadonlyMap<string | undefined, string>,
  fixedPrefixes: ReadonlySet<string | undefined> | undefined,
  generated: Array<RenderedDeclaration>,
  namespaceUndo: Array<NamespaceUndo>,
  nextGeneratedPrefix: () => string,
  version: XmlVersion,
) => {
  const nameIssue = validateTypedName(name, attribute, version);
  if (nameIssue !== undefined) return Result.fail<SchemaIssue.Issue>(nameIssue);

  const namespaceUri = name.namespaceUri;
  if (namespaceUri === undefined) {
    if (!attribute) {
      const explicitDefault = explicitBindings.get(undefined);
      if (explicitDefault !== undefined && explicitDefault !== "") {
        return failure(
          "An unnamespaced typed element cannot preserve its explicit nonempty default namespace",
        );
      }
      const defaultNamespace = bindings.lookup(undefined);
      if (defaultNamespace !== undefined && defaultNamespace !== "") {
        if (fixedPrefixes !== undefined) {
          return failure(
            "An unnamespaced typed element cannot change the effective Rest namespace snapshot",
          );
        }
        generated.push({ prefix: undefined, namespaceUri: "" });
        namespaceUndo.push(bindings.enter(undefined, ""));
      }
    }
    return Result.succeed(name.localName);
  }

  const active = bindings.findPrefix(namespaceUri, !attribute);
  if (active !== undefined) {
    return Result.succeed(
      active.prefix === undefined ? name.localName : `${active.prefix}:${name.localName}`,
    );
  }
  if (fixedPrefixes !== undefined) {
    return failure(
      `${attribute ? "Attribute" : "Element"} ${JSON.stringify(qualifiedName(name))} requires namespace ${JSON.stringify(namespaceUri)}, which is not available in the effective Rest namespace snapshot`,
    );
  }

  let prefix: string | undefined;
  if (!attribute && name.prefix === undefined && !explicitBindings.has(undefined)) {
    prefix = undefined;
  } else if (
    name.prefix !== undefined &&
    !bindings.isBound(name.prefix) &&
    !explicitBindings.has(name.prefix)
  ) {
    prefix = name.prefix;
  } else prefix = nextGeneratedPrefix();

  generated.push({ prefix, namespaceUri });
  namespaceUndo.push(bindings.enter(prefix, namespaceUri));
  return Result.succeed(prefix === undefined ? name.localName : `${prefix}:${name.localName}`);
};

const serializeElementStart = (
  element: Element,
  bindings: ActiveNamespaces,
  typed: boolean,
  rawAttributes: WeakSet<Attribute> | undefined,
  restNamespaces: WeakMap<Element, NamespaceContext> | undefined,
  nextGeneratedPrefix: () => string,
  version: XmlVersion,
) => {
  let declarations = element.namespaceDeclarations;
  let fixedPrefixes: ReadonlySet<string | undefined> | undefined;
  const restNamespaceInput = restNamespaces?.get(element);
  if (restNamespaceInput !== undefined) {
    const contextResult = decodeNamespaceContext(restNamespaceInput);
    if (Result.isFailure(contextResult)) return Result.fail(contextResult.failure);
    const firstBinding = contextResult.success.bindings[0];
    if (firstBinding?.prefix !== "xml" || firstBinding.namespaceUri !== xmlNamespace) {
      return failure(
        "An effective Rest namespace snapshot must begin with the implicit xml binding",
      );
    }
    if (contextResult.success.bindings.some((binding) => binding.namespaceUri === "")) {
      return failure("An effective Rest namespace snapshot cannot contain an empty binding");
    }
    const restored = restoreRestNamespaceDeclarations(
      declarations,
      contextResult.success,
      bindings,
      version,
    );
    if (Result.isFailure(restored)) return Result.fail(restored.failure);
    [declarations, fixedPrefixes] = restored.success;
  }

  const scopeResult = enterNamespaceScope(declarations, bindings, typed, version, fixedPrefixes);
  if (Result.isFailure(scopeResult)) return Result.fail(scopeResult.failure);
  const [explicitDeclarations, entered, explicitBindings] = scopeResult.success;
  const namespaceUndo = [...entered];
  const generatedDeclarations: Array<RenderedDeclaration> = [];
  const nextAvailablePrefix = () => {
    let prefix: string;
    do prefix = nextGeneratedPrefix();
    while (explicitBindings.has(prefix));
    return prefix;
  };

  const elementNameResult = typed
    ? allocateTypedName(
        element.name,
        false,
        bindings,
        explicitBindings,
        fixedPrefixes,
        generatedDeclarations,
        namespaceUndo,
        nextAvailablePrefix,
        version,
      )
    : (() => {
        const issue = validateBoundName(element.name, bindings, false);
        return issue === undefined
          ? Result.succeed(qualifiedName(element.name))
          : Result.fail<SchemaIssue.Issue>(issue);
      })();
  if (Result.isFailure(elementNameResult)) return Result.fail(elementNameResult.failure);

  const expandedAttributes = new Map<string | undefined, Set<string>>();
  const renderedAttributes: Array<readonly [string, string]> = [];
  for (const attribute of element.attributes) {
    const attributeNameResult =
      typed && rawAttributes?.has(attribute) !== true
        ? allocateTypedName(
            attribute.name,
            true,
            bindings,
            explicitBindings,
            fixedPrefixes,
            generatedDeclarations,
            namespaceUndo,
            nextAvailablePrefix,
            version,
          )
        : (() => {
            const issue = validateBoundName(attribute.name, bindings, true);
            return issue === undefined
              ? Result.succeed(qualifiedName(attribute.name))
              : Result.fail<SchemaIssue.Issue>(issue);
          })();
    if (Result.isFailure(attributeNameResult)) return Result.fail(attributeNameResult.failure);

    let localNames = expandedAttributes.get(attribute.name.namespaceUri);
    if (localNames === undefined) {
      localNames = new Set();
      expandedAttributes.set(attribute.name.namespaceUri, localNames);
    }
    if (localNames.has(attribute.name.localName)) {
      return failure(
        `Duplicate attribute expanded name {${attribute.name.namespaceUri ?? ""}}${attribute.name.localName}`,
      );
    }
    localNames.add(attribute.name.localName);

    const escaped = escapeAttribute(
      attribute.value,
      `Attribute ${JSON.stringify(attributeNameResult.success)}`,
      version,
    );
    if (Result.isFailure(escaped)) return Result.fail(escaped.failure);
    renderedAttributes.push([attributeNameResult.success, escaped.success]);
  }

  const output: Array<string> = [`<${elementNameResult.success}`];
  for (const declaration of [...explicitDeclarations, ...generatedDeclarations]) {
    const escaped = escapeAttribute(declaration.namespaceUri, "Namespace URI", version);
    if (Result.isFailure(escaped)) return Result.fail(escaped.failure);
    const declarationName =
      declaration.prefix === undefined ? "xmlns" : `xmlns:${declaration.prefix}`;
    output.push(` ${declarationName}="${escaped.success}"`);
  }
  for (const [name, value] of renderedAttributes) output.push(` ${name}="${value}"`);

  return Result.succeed<readonly [string, string, ReadonlyArray<NamespaceUndo>]>([
    output.join(""),
    elementNameResult.success,
    namespaceUndo,
  ]);
};

const serializeLeaf = (node: Exclude<Child | Misc, Element>, version: XmlVersion) => {
  if (isText(node)) return escapeText(node.value, version);
  if (isCData(node)) {
    const literalIssue = validateLiteral(node.value, "CDATA", version);
    return literalIssue === undefined
      ? Result.succeed(`<![CDATA[${node.value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`)
      : Result.fail<SchemaIssue.Issue>(literalIssue);
  }
  if (isComment(node)) {
    const literalIssue = validateLiteral(node.value, "Comment", version);
    if (literalIssue !== undefined) return Result.fail<SchemaIssue.Issue>(literalIssue);
    if (node.value.includes("--") || node.value.endsWith("-")) {
      return failure("Comment content must not contain -- or end with -");
    }
    return Result.succeed(`<!--${node.value}-->`);
  }
  if (isProcessingInstruction(node)) {
    if (!isNcName(node.target) || node.target.toLowerCase() === "xml") {
      return failure(`Processing instruction target ${JSON.stringify(node.target)} is invalid`);
    }
    const literalIssue = validateLiteral(node.value, "Processing instruction data", version);
    if (literalIssue !== undefined) return Result.fail<SchemaIssue.Issue>(literalIssue);
    const first = node.value.charCodeAt(0);
    if (first === 0x09 || first === 0x0a || first === 0x0d || first === 0x20) {
      return failure("Processing instruction data must not start with XML whitespace");
    }
    if (node.value.includes("?>")) {
      return failure("Processing instruction data must not contain ?>");
    }
    return Result.succeed(
      node.value.length === 0 ? `<?${node.target}?>` : `<?${node.target} ${node.value}?>`,
    );
  }
  return failure("Unsupported XML node");
};

interface WriterOptions {
  readonly pretty: boolean;
  readonly indent: string;
  readonly structured: WeakSet<Element> | undefined;
  readonly typed: WeakSet<Element> | undefined;
  readonly rawAttributes: WeakSet<Attribute> | undefined;
  readonly restNamespaces: WeakMap<Element, NamespaceContext> | undefined;
}

const validateOptions = (options: SerializeOptions | undefined) => {
  const input: unknown = options;
  if (input !== undefined && !Predicate.isObject(input)) {
    return failure("Serializer options must be an object");
  }
  if (
    Predicate.isObject(input) &&
    Predicate.hasProperty(input, "pretty") &&
    input.pretty !== undefined &&
    !Predicate.isBoolean(input.pretty)
  ) {
    return failure("Serializer option pretty must be a boolean");
  }
  if (
    Predicate.isObject(input) &&
    Predicate.hasProperty(input, "indent") &&
    input.indent !== undefined &&
    !Predicate.isString(input.indent)
  ) {
    return failure("Serializer option indent must be a string");
  }
  if (
    Predicate.isObject(input) &&
    Predicate.hasProperty(input, "structured") &&
    input.structured !== undefined &&
    !(input.structured instanceof WeakSet)
  ) {
    return failure("Serializer option structured must be a WeakSet");
  }
  if (
    Predicate.isObject(input) &&
    Predicate.hasProperty(input, "typed") &&
    input.typed !== undefined &&
    !(input.typed instanceof WeakSet)
  ) {
    return failure("Serializer option typed must be a WeakSet");
  }
  if (
    Predicate.isObject(input) &&
    Predicate.hasProperty(input, "rawAttributes") &&
    input.rawAttributes !== undefined &&
    !(input.rawAttributes instanceof WeakSet)
  ) {
    return failure("Serializer option rawAttributes must be a WeakSet");
  }
  if (
    Predicate.isObject(input) &&
    Predicate.hasProperty(input, "restNamespaces") &&
    input.restNamespaces !== undefined &&
    !(input.restNamespaces instanceof WeakMap)
  ) {
    return failure("Serializer option restNamespaces must be a WeakMap");
  }

  const pretty = options?.pretty ?? true;
  const indent = options?.indent ?? "  ";
  if (pretty && !/^[\t ]*$/u.test(indent)) {
    return failure("Serializer indent must contain only spaces and tabs");
  }
  return Result.succeed<WriterOptions>({
    pretty,
    indent,
    structured: options?.structured,
    typed: options?.typed,
    rawAttributes: options?.rawAttributes,
    restNamespaces: options?.restNamespaces,
  });
};

const fragmentVersion = (options: FragmentSerializeOptions | undefined) => {
  const input: unknown = options;
  if (
    Predicate.isObject(input) &&
    Predicate.hasProperty(input, "version") &&
    input.version !== undefined &&
    input.version !== "1.0" &&
    input.version !== "1.1"
  ) {
    return failure('Serializer option version must be "1.0" or "1.1"');
  }
  return Result.succeed<XmlVersion>(options?.version ?? "1.0");
};

const fragmentNamespaces = (options: FragmentSerializeOptions | undefined, version: XmlVersion) => {
  const input: unknown = options;
  if (
    !Predicate.isObject(input) ||
    !Predicate.hasProperty(input, "namespaces") ||
    input.namespaces === undefined
  ) {
    return Result.succeed<NamespaceContext | undefined>(undefined);
  }

  const contextResult = decodeNamespaceContext(input.namespaces);
  if (Result.isFailure(contextResult)) return Result.fail(contextResult.failure);
  for (const binding of contextResult.success.bindings) {
    const bindingIssue = validateBinding(binding.prefix, binding.namespaceUri, version);
    if (bindingIssue !== undefined) return failure(bindingIssue);
    const characterIssue = invalidCharacter(binding.namespaceUri, "Namespace URI", version);
    if (characterIssue !== undefined) return Result.fail(characterIssue);
  }
  return Result.succeed<NamespaceContext | undefined>(contextResult.success);
};

interface WriteNodesOptions {
  readonly nodes: ReadonlyArray<Child | Misc>;
  readonly version: XmlVersion;
  readonly writer: WriterOptions;
  readonly bindings: ActiveNamespaces;
  readonly leadingOutput?: string;
  readonly formatTopLevel?: boolean;
}

/** Shared iterative writer for complete documents and unwrapped fragments. */
const writeNodes = (options: WriteNodesOptions) => {
  const { bindings, nodes, version, writer } = options;
  const output: Array<string> = [];
  if (options.leadingOutput !== undefined && options.leadingOutput.length > 0) {
    output.push(options.leadingOutput);
  }

  let generatedPrefix = 1;
  const nextGeneratedPrefix = () => {
    let prefix: string;
    do prefix = `ns${generatedPrefix++}`;
    while (bindings.isBound(prefix));
    return prefix;
  };

  const actions: Array<Action> = [];
  for (let index = nodes.length - 1; index >= 0; index--) {
    actions.push({ node: nodes[index]!, preserveSpace: false, depth: 0 });
    if (
      options.formatTopLevel === true &&
      (index > 0 || (options.leadingOutput?.length ?? 0) > 0)
    ) {
      actions.push({ output: "\n" });
    }
  }

  while (actions.length > 0) {
    const action = actions.pop();
    if (action === undefined) continue;
    if ("output" in action) {
      output.push(action.output);
      continue;
    }
    if ("namespaceUndo" in action) {
      exitNamespaceScope(action.namespaceUndo, bindings);
      continue;
    }

    const { depth, node, preserveSpace: inheritedSpace } = action;
    if (!isElement(node)) {
      const leafResult = serializeLeaf(node, version);
      if (Result.isFailure(leafResult)) return leafResult;
      output.push(leafResult.success);
      continue;
    }

    const startResult = serializeElementStart(
      node,
      bindings,
      writer.typed?.has(node) === true,
      writer.rawAttributes,
      writer.restNamespaces,
      nextGeneratedPrefix,
      version,
    );
    if (Result.isFailure(startResult)) return Result.fail(startResult.failure);
    const [start, closingName, namespaceUndo] = startResult.success;
    const preserveSpace = xmlSpace(node, inheritedSpace);
    output.push(start);

    if (node.children.length === 0) {
      output.push("/>");
      exitNamespaceScope(namespaceUndo, bindings);
      continue;
    }
    output.push(">");

    const formatChildren = canFormatChildren(node, writer.pretty, writer.structured, preserveSpace);
    actions.push({ namespaceUndo });
    actions.push({
      output: formatChildren
        ? `\n${writer.indent.repeat(depth)}</${closingName}>`
        : `</${closingName}>`,
    });
    for (let index = node.children.length - 1; index >= 0; index--) {
      actions.push({ node: node.children[index]!, preserveSpace, depth: depth + 1 });
      if (formatChildren) {
        actions.push({ output: `\n${writer.indent.repeat(depth + 1)}` });
      }
    }
  }

  return Result.succeed(output.join(""));
};

/** Serializes a fully validated XML document without recursive tree traversal. */
export const serializeDocument = (
  document: Document,
  options?: SerializeOptions,
): Result.Result<string, SchemaIssue.Issue> => {
  const optionResult = validateOptions(options);
  if (Result.isFailure(optionResult)) return Result.fail(optionResult.failure);

  const structureIssue = validateDocumentStructure(document);
  if (structureIssue !== undefined) return Result.fail(structureIssue);
  const declarationResult = serializeDeclaration(document);
  if (Result.isFailure(declarationResult)) return declarationResult;
  const version = document.declaration?.version ?? "1.0";
  const nodes: ReadonlyArray<Child | Misc> = [
    ...document.prolog,
    document.root,
    ...document.epilog,
  ];
  return writeNodes({
    nodes,
    version,
    writer: optionResult.success,
    bindings: new ActiveNamespaces(),
    leadingOutput: declarationResult.success,
    formatTopLevel:
      optionResult.success.pretty && optionResult.success.structured?.has(document.root) === true,
  });
};

/** Serializes ordered XML content without adding a declaration, DTD, or wrapper node. */
export const serializeFragment = (
  fragment: AstFragment,
  options?: FragmentSerializeOptions,
): Result.Result<string, SchemaIssue.Issue> => {
  const optionResult = validateOptions(options);
  if (Result.isFailure(optionResult)) return Result.fail(optionResult.failure);
  const versionResult = fragmentVersion(options);
  if (Result.isFailure(versionResult)) return Result.fail(versionResult.failure);
  const namespacesResult = fragmentNamespaces(options, versionResult.success);
  if (Result.isFailure(namespacesResult)) return Result.fail(namespacesResult.failure);

  const structureIssue = validateFragmentStructure(fragment);
  if (structureIssue !== undefined) return Result.fail(structureIssue);

  const bindings = new ActiveNamespaces();
  for (const binding of namespacesResult.success?.bindings ?? []) {
    bindings.enter(binding.prefix, binding.namespaceUri);
  }
  const writeOptions = {
    nodes: fragment.children,
    version: versionResult.success,
    writer: optionResult.success,
    bindings,
  };
  return writeNodes(writeOptions);
};
