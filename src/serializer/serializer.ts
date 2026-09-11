import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaParser from "effect/SchemaParser";

import { Document, type Misc } from "../ast/document.ts";
import { isElement, type Child, type Element } from "../ast/element.ts";
import type { Name } from "../ast/name.ts";
import type { NamespaceDeclaration } from "../ast/namespace-declaration.ts";
import { isProcessingInstruction } from "../ast/processing-instruction.ts";
import { isCData, isText } from "../ast/text.ts";
import { isComment } from "../ast/comment.ts";
import { isNcName, isXml10Char } from "../parser/character.ts";
import { ActiveNamespaces, type NamespaceUndo } from "../namespace/prefix.ts";
import { validateBinding, xmlNamespace, xmlnsNamespace } from "../namespace/validation.ts";

/** Options used by the low-level XML document serializer. */
export interface SerializeOptions {
  readonly pretty?: boolean;
  readonly indent?: string;
  /** Elements whose typed content model permits inserted formatting whitespace. */
  readonly structured?: WeakSet<Element>;
  /** @internal Elements produced by typed codecs whose namespace prefixes may be allocated. */
  readonly typed?: WeakSet<Element>;
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

const decodeDocument = SchemaParser.decodeUnknownResult(Document);

const invalid = (message: string) => new SchemaIssue.InvalidValue({ message });

const failure = (message: string) => Result.fail<SchemaIssue.Issue>(invalid(message));

/** Finds recursive element cycles without rejecting shared, already-completed subtrees. */
const findElementCycle = (document: Document) => {
  const input: unknown = document;
  if (!Predicate.isObject(input) || !Predicate.hasProperty(input, "root")) return false;
  const root = input.root;
  if (!Predicate.isObject(root) || !Predicate.hasProperty(root, "children")) return false;

  interface ElementCandidate {
    readonly children: unknown;
  }

  interface Visit {
    readonly element: ElementCandidate;
    readonly exiting: boolean;
  }

  const states = new WeakMap<object, "active" | "complete">();
  const work: Array<Visit> = [{ element: root, exiting: false }];
  while (work.length > 0) {
    const visit = work.pop();
    if (visit === undefined) continue;

    if (visit.exiting) {
      states.set(visit.element, "complete");
      continue;
    }

    const state = states.get(visit.element);
    if (state === "active") return true;
    if (state === "complete") continue;

    states.set(visit.element, "active");
    work.push({ element: visit.element, exiting: true });

    const children = visit.element.children;
    if (!Array.isArray(children)) continue;
    for (let index = children.length - 1; index >= 0; index--) {
      const child: unknown = children[index];
      if (
        Predicate.isObject(child) &&
        Predicate.hasProperty(child, "children") &&
        Array.isArray(child.children)
      ) {
        work.push({ element: child, exiting: false });
      }
    }
  }
  return false;
};

const codePointLabel = (codePoint: number) =>
  `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;

const invalidCharacter = (value: string, context: string) => {
  let offset = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || !isXml10Char(codePoint)) {
      return invalid(
        `${context} contains an invalid XML 1.0 character ${codePointLabel(codePoint ?? 0)} at UTF-16 offset ${offset}`,
      );
    }
    offset += character.length;
  }
  return undefined;
};

const escapeText = (value: string) => {
  const characterIssue = invalidCharacter(value, "Text");
  if (characterIssue !== undefined) return Result.fail(characterIssue);

  const output: Array<string> = [];
  let literalStart = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    let replacement: string | undefined;
    if (character === "&") replacement = "&amp;";
    else if (character === "<") replacement = "&lt;";
    else if (character === "\r") replacement = "&#xD;";
    else if (character === ">") replacement = "&gt;";
    if (replacement === undefined) continue;
    output.push(value.slice(literalStart, index), replacement);
    literalStart = index + 1;
  }
  output.push(value.slice(literalStart));
  return Result.succeed(output.join(""));
};

const escapeAttribute = (value: string, context: string) => {
  const characterIssue = invalidCharacter(value, context);
  if (characterIssue !== undefined) return Result.fail(characterIssue);

  const output: Array<string> = [];
  let literalStart = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    let replacement: string | undefined;
    if (character === "&") replacement = "&amp;";
    else if (character === "<") replacement = "&lt;";
    else if (character === '"') replacement = "&quot;";
    else if (character === "\t") replacement = "&#x9;";
    else if (character === "\n") replacement = "&#xA;";
    else if (character === "\r") replacement = "&#xD;";
    if (replacement === undefined) continue;
    output.push(value.slice(literalStart, index), replacement);
    literalStart = index + 1;
  }
  output.push(value.slice(literalStart));
  return Result.succeed(output.join(""));
};

const validateLiteral = (value: string, context: string) => {
  const characterIssue = invalidCharacter(value, context);
  if (characterIssue !== undefined) return characterIssue;
  const carriageReturn = value.indexOf("\r");
  return carriageReturn < 0
    ? undefined
    : invalid(
        `${context} contains a literal carriage return at UTF-16 offset ${carriageReturn}, which XML parsing would normalize`,
      );
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
  const resolved = bindings.lookup(name.prefix);
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
) => {
  const declared = new Map<string | undefined, string>();
  for (const declaration of declarations) {
    if (declared.has(declaration.prefix)) {
      return failure(
        `Namespace prefix ${JSON.stringify(declaration.prefix)} is declared more than once on one element`,
      );
    }
    declared.set(declaration.prefix, declaration.namespaceUri);
    const bindingIssue = validateBinding(declaration.prefix, declaration.namespaceUri);
    if (bindingIssue !== undefined) return failure(bindingIssue);
  }

  const emitted: Array<NamespaceDeclaration> = [];
  const undo: Array<NamespaceUndo> = [];
  for (const declaration of declarations) {
    const current = bindings.lookup(declaration.prefix);
    const redundant =
      typed &&
      (current === declaration.namespaceUri ||
        (declaration.prefix === undefined &&
          declaration.namespaceUri === "" &&
          current === undefined));
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
  if (declaration.version !== "1.0") {
    return failure("XML 1.1 serialization is not supported by the RSS serializer");
  }
  if (
    declaration.encoding !== undefined &&
    !/^[A-Za-z][A-Za-z0-9._-]*$/u.test(declaration.encoding)
  ) {
    return failure(`XML declaration encoding ${JSON.stringify(declaration.encoding)} is invalid`);
  }

  let output = '<?xml version="1.0"';
  if (declaration.encoding !== undefined) output += ` encoding="${declaration.encoding}"`;
  if (declaration.standalone !== undefined) output += ` standalone="${declaration.standalone}"`;
  return Result.succeed(`${output}?>`);
};

interface RenderedDeclaration {
  readonly prefix: string | undefined;
  readonly namespaceUri: string;
}

const validateTypedName = (name: Name, attribute: boolean) => {
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
  const bindingIssue = validateBinding(name.prefix, name.namespaceUri);
  return bindingIssue === undefined ? undefined : invalid(bindingIssue);
};

const allocateTypedName = (
  name: Name,
  attribute: boolean,
  bindings: ActiveNamespaces,
  explicitBindings: ReadonlyMap<string | undefined, string>,
  generated: Array<RenderedDeclaration>,
  namespaceUndo: Array<NamespaceUndo>,
  nextGeneratedPrefix: () => string,
) => {
  const nameIssue = validateTypedName(name, attribute);
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

  let prefix: string | undefined;
  if (!attribute && name.prefix === undefined && !explicitBindings.has(undefined)) {
    prefix = undefined;
  } else if (name.prefix !== undefined && !bindings.hasPrefix(name.prefix)) prefix = name.prefix;
  else prefix = nextGeneratedPrefix();

  generated.push({ prefix, namespaceUri });
  namespaceUndo.push(bindings.enter(prefix, namespaceUri));
  return Result.succeed(prefix === undefined ? name.localName : `${prefix}:${name.localName}`);
};

const serializeElementStart = (
  element: Element,
  bindings: ActiveNamespaces,
  typed: boolean,
  nextGeneratedPrefix: () => string,
) => {
  const scopeResult = enterNamespaceScope(element.namespaceDeclarations, bindings, typed);
  if (Result.isFailure(scopeResult)) return Result.fail(scopeResult.failure);
  const [explicitDeclarations, entered, explicitBindings] = scopeResult.success;
  const namespaceUndo = [...entered];
  const generatedDeclarations: Array<RenderedDeclaration> = [];

  const elementNameResult = typed
    ? allocateTypedName(
        element.name,
        false,
        bindings,
        explicitBindings,
        generatedDeclarations,
        namespaceUndo,
        nextGeneratedPrefix,
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
    const attributeNameResult = typed
      ? allocateTypedName(
          attribute.name,
          true,
          bindings,
          explicitBindings,
          generatedDeclarations,
          namespaceUndo,
          nextGeneratedPrefix,
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
    );
    if (Result.isFailure(escaped)) return Result.fail(escaped.failure);
    renderedAttributes.push([attributeNameResult.success, escaped.success]);
  }

  const output: Array<string> = [`<${elementNameResult.success}`];
  for (const declaration of [...explicitDeclarations, ...generatedDeclarations]) {
    const escaped = escapeAttribute(declaration.namespaceUri, "Namespace URI");
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

const serializeLeaf = (node: Exclude<Child | Misc, Element>) => {
  if (isText(node)) return escapeText(node.value);
  if (isCData(node)) {
    const literalIssue = validateLiteral(node.value, "CDATA");
    return literalIssue === undefined
      ? Result.succeed(`<![CDATA[${node.value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`)
      : Result.fail<SchemaIssue.Issue>(literalIssue);
  }
  if (isComment(node)) {
    const literalIssue = validateLiteral(node.value, "Comment");
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
    const literalIssue = validateLiteral(node.value, "Processing instruction data");
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

  const pretty = options?.pretty ?? true;
  const indent = options?.indent ?? "  ";
  const structured = options?.structured;
  const typed = options?.typed;
  if (pretty && !/^[\t ]*$/u.test(indent)) {
    return failure("Serializer indent must contain only spaces and tabs");
  }
  return Result.succeed<
    readonly [boolean, string, WeakSet<Element> | undefined, WeakSet<Element> | undefined]
  >([pretty, indent, structured, typed]);
};

/** Serializes a fully validated XML 1.0 document without recursive tree traversal. */
// RETURN TYPE: Keeps the serializer contract's public Effect issue channel stable
export const serializeDocument = (
  document: Document,
  options?: SerializeOptions,
): Result.Result<string, SchemaIssue.Issue> => {
  const optionResult = validateOptions(options);
  if (Result.isFailure(optionResult)) return Result.fail(optionResult.failure);
  const [pretty, indent, structured, typed] = optionResult.success;

  if (findElementCycle(document)) return failure("XML element content contains a cycle");

  const documentResult = decodeDocument(document);
  if (Result.isFailure(documentResult)) return Result.fail(documentResult.failure);

  const declarationResult = serializeDeclaration(document);
  if (Result.isFailure(declarationResult)) return declarationResult;

  const topLevel: ReadonlyArray<Child | Misc> = [
    ...document.prolog,
    document.root,
    ...document.epilog,
  ];
  const formatDocument = pretty && structured?.has(document.root) === true;
  const output: Array<string> = [];
  if (declarationResult.success.length > 0) output.push(declarationResult.success);

  const bindings = new ActiveNamespaces();
  let generatedPrefix = 1;
  const nextGeneratedPrefix = () => {
    let prefix: string;
    do prefix = `ns${generatedPrefix++}`;
    while (bindings.hasPrefix(prefix));
    return prefix;
  };
  const actions: Array<Action> = [];
  for (let index = topLevel.length - 1; index >= 0; index--) {
    actions.push({
      node: topLevel[index]!,
      preserveSpace: false,
      depth: 0,
    });
    if (formatDocument && (index > 0 || declarationResult.success.length > 0)) {
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
      const leafResult = serializeLeaf(node);
      if (Result.isFailure(leafResult)) return leafResult;
      output.push(leafResult.success);
      continue;
    }

    const startResult = serializeElementStart(
      node,
      bindings,
      typed?.has(node) === true,
      nextGeneratedPrefix,
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

    const formatChildren = canFormatChildren(node, pretty, structured, preserveSpace);
    actions.push({ namespaceUndo });
    actions.push({
      output: formatChildren ? `\n${indent.repeat(depth)}</${closingName}>` : `</${closingName}>`,
    });
    for (let index = node.children.length - 1; index >= 0; index--) {
      actions.push({
        node: node.children[index]!,
        preserveSpace,
        depth: depth + 1,
      });
      if (formatChildren) {
        actions.push({ output: `\n${indent.repeat(depth + 1)}` });
      }
    }
  }

  return Result.succeed(output.join(""));
};
