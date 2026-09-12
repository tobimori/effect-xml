import { xmlNamespace } from "./validation.ts";

type Prefix = string | undefined;

interface BindingNode {
  readonly prefix: Prefix;
  readonly namespaceUri: string;
  readonly previousForPrefix: BindingNode | undefined;
  previousForUri: BindingNode | undefined;
  nextForUri: BindingNode | undefined;
}

interface UriBindings {
  first: BindingNode | undefined;
  last: BindingNode | undefined;
}

/** Opaque record used to restore one namespace binding on scope exit. */
export interface NamespaceUndo {
  readonly added: BindingNode | undefined;
}

/** Active namespace bindings with a reverse URI index and constant-time scope undo. */
export class ActiveNamespaces {
  readonly #byPrefix = new Map<Prefix, BindingNode>();
  readonly #byUri = new Map<string, UriBindings>();

  lookup(prefix: Prefix) {
    return prefix === "xml" ? xmlNamespace : this.#byPrefix.get(prefix)?.namespaceUri;
  }

  /** Resolves a name prefix, treating an XML 1.1 empty prefixed binding as undeclared. */
  resolve(prefix: Prefix) {
    const namespaceUri = this.lookup(prefix);
    return prefix !== undefined && namespaceUri === "" ? undefined : namespaceUri;
  }

  *prefixes() {
    for (const [namespaceUri, bindings] of this.#byUri) {
      if (namespaceUri === "") continue;
      let binding = bindings.first;
      while (binding !== undefined) {
        yield binding.prefix;
        binding = binding.nextForUri;
      }
    }
  }

  isBound(prefix: Prefix) {
    return this.resolve(prefix) !== undefined;
  }

  findPrefix(namespaceUri: string, allowDefault: boolean) {
    if (namespaceUri === xmlNamespace) return { prefix: "xml" };

    let binding = this.#byUri.get(namespaceUri)?.first;
    if (!allowDefault && binding !== undefined && binding.prefix === undefined) {
      binding = binding.nextForUri;
    }
    return binding === undefined ? undefined : { prefix: binding.prefix };
  }

  enter(prefix: Prefix, namespaceUri: string) {
    if (prefix === "xml") return { added: undefined };

    const previous = this.#byPrefix.get(prefix);
    if (previous?.namespaceUri === namespaceUri) return { added: undefined };
    if (previous !== undefined) this.#removeFromUri(previous);

    const bucket = this.#byUri.get(namespaceUri) ?? { first: undefined, last: undefined };
    const added: BindingNode = {
      prefix,
      namespaceUri,
      previousForPrefix: previous,
      previousForUri: bucket.last,
      nextForUri: undefined,
    };
    if (bucket.last === undefined) bucket.first = added;
    else bucket.last.nextForUri = added;
    bucket.last = added;
    this.#byUri.set(namespaceUri, bucket);
    this.#byPrefix.set(prefix, added);
    return { added };
  }

  exit(undo: NamespaceUndo) {
    const added = undo.added;
    if (added === undefined) return;

    this.#removeFromUri(added);
    const previous = added.previousForPrefix;
    if (previous === undefined) this.#byPrefix.delete(added.prefix);
    else {
      this.#restoreToUri(previous);
      this.#byPrefix.set(previous.prefix, previous);
    }
  }

  #removeFromUri(binding: BindingNode) {
    const bucket = this.#byUri.get(binding.namespaceUri)!;
    if (binding.previousForUri === undefined) bucket.first = binding.nextForUri;
    else binding.previousForUri.nextForUri = binding.nextForUri;
    if (binding.nextForUri === undefined) bucket.last = binding.previousForUri;
    else binding.nextForUri.previousForUri = binding.previousForUri;
    if (bucket.first === undefined) this.#byUri.delete(binding.namespaceUri);
  }

  #restoreToUri(binding: BindingNode) {
    let bucket = this.#byUri.get(binding.namespaceUri);
    if (bucket === undefined) {
      bucket = { first: binding, last: binding };
      this.#byUri.set(binding.namespaceUri, bucket);
    } else {
      if (binding.previousForUri === undefined) bucket.first = binding;
      else binding.previousForUri.nextForUri = binding;
      if (binding.nextForUri === undefined) bucket.last = binding;
      else binding.nextForUri.previousForUri = binding;
    }
  }
}
