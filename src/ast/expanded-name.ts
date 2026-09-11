/** The namespace URI and local name that identify an XML name. */
export interface ExpandedName {
  readonly localName: string;
  readonly namespaceUri?: string;
}

/** Tests expanded-name identity without considering prefixes. */
export const equalsName = (first: ExpandedName, second: ExpandedName) =>
  first.localName === second.localName && first.namespaceUri === second.namespaceUri;
