import { isNcName, type XmlVersion } from "../parser/character.ts";

/** Namespace name reserved by XML for the `xml` prefix. */
export const xmlNamespace = "http://www.w3.org/XML/1998/namespace";

/** Namespace name reserved for namespace declaration attributes. */
export const xmlnsNamespace = "http://www.w3.org/2000/xmlns/";

/**
 * Validates one raw XML namespace declaration. An omitted prefix is the
 * default namespace; `undefined` means the binding is valid. The default keeps
 * effective public namespace contexts on the stricter XML Namespaces 1.0 rule.
 */
export const validateBinding = (
  prefix: string | undefined,
  namespaceUri: string,
  version: XmlVersion = "1.0",
) => {
  if (prefix !== undefined && !isNcName(prefix)) return "A namespace prefix must be an NCName";
  if (prefix === "xmlns") return "The xmlns prefix is reserved for namespace declarations";
  if (namespaceUri === xmlnsNamespace) return "The xmlns namespace name is reserved";
  if (prefix === "xml" && namespaceUri !== xmlNamespace) {
    return "The xml prefix must be bound to its reserved namespace name";
  }
  if (prefix !== "xml" && namespaceUri === xmlNamespace) {
    return "Only the xml prefix may be bound to the XML namespace name";
  }
  if (prefix !== undefined && namespaceUri.length === 0 && version === "1.0") {
    return "XML Namespaces 1.0 does not allow a prefix to be undeclared";
  }
  return undefined;
};
