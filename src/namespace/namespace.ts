import * as Schema from "effect/Schema";

import type { Attribute as AttributeNode } from "../ast/attribute.ts";
import type { Element as ElementNode } from "../ast/element.ts";
import { attributeWithNameDefaults } from "../schema/attribute.ts";
import { elementWithNameDefaults, type ElementContentInput } from "../schema/element.ts";
import { validateBinding, xmlnsNamespace } from "./validation.ts";

interface NamespaceFieldsInput {
  namespaceUri: string;
  prefix?: string;
}

const NamespaceFields = Schema.Struct({
  namespaceUri: Schema.String.check(Schema.isNonEmpty()),
  prefix: Schema.optionalKey(Schema.String),
}).check(
  Schema.makeFilter((namespace) => {
    if (namespace.namespaceUri === xmlnsNamespace) return "The xmlns namespace name is reserved";
    return namespace.prefix === undefined
      ? undefined
      : validateBinding(namespace.prefix, namespace.namespaceUri);
  }),
);

export interface NamespaceElement {
  <S extends Schema.Constraint>(
    content: ElementContentInput<S>,
  ): Schema.Codec<S["Type"], ElementNode, S["DecodingServices"], S["EncodingServices"]>;
  <S extends Schema.Constraint>(
    localName: string,
    content: ElementContentInput<S>,
  ): Schema.Codec<S["Type"], ElementNode, S["DecodingServices"], S["EncodingServices"]>;
}

export interface NamespaceAttribute {
  <S extends Schema.Constraint>(
    schema: S,
  ): Schema.Codec<S["Type"], AttributeNode, S["DecodingServices"], S["EncodingServices"]>;
  <S extends Schema.Constraint>(
    localName: string,
    schema: S,
  ): Schema.Codec<S["Type"], AttributeNode, S["DecodingServices"], S["EncodingServices"]>;
}

/** A validated namespace's lightweight typed-codec constructors. */
export interface Namespace {
  readonly namespaceUri: string;
  readonly prefix?: string;
  readonly Element: NamespaceElement;
  readonly Attribute: NamespaceAttribute;
}

/** Creates Element and Attribute constructors with one namespace and prefix preference. */
export const Namespace = (
  namespaceUri: string,
  options: { readonly prefix?: string } = {},
): Namespace => {
  const input: NamespaceFieldsInput = { namespaceUri };
  if (options.prefix !== undefined) input.prefix = options.prefix;
  const fields = NamespaceFields.make(input);
  const defaults =
    fields.prefix === undefined
      ? { namespaceUri: fields.namespaceUri }
      : { namespaceUri: fields.namespaceUri, prefix: fields.prefix };

  function Element<S extends Schema.Constraint>(
    content: ElementContentInput<S>,
  ): Schema.Codec<S["Type"], ElementNode, S["DecodingServices"], S["EncodingServices"]>;
  function Element<S extends Schema.Constraint>(
    localName: string,
    content: ElementContentInput<S>,
  ): Schema.Codec<S["Type"], ElementNode, S["DecodingServices"], S["EncodingServices"]>;
  function Element<S extends Schema.Constraint>(nameOrContent: string | S, maybeContent?: S) {
    return elementWithNameDefaults(defaults, nameOrContent, maybeContent);
  }

  function Attribute<S extends Schema.Constraint>(
    schema: S,
  ): Schema.Codec<S["Type"], AttributeNode, S["DecodingServices"], S["EncodingServices"]>;
  function Attribute<S extends Schema.Constraint>(
    localName: string,
    schema: S,
  ): Schema.Codec<S["Type"], AttributeNode, S["DecodingServices"], S["EncodingServices"]>;
  function Attribute<S extends Schema.Constraint>(nameOrSchema: string | S, maybeSchema?: S) {
    return attributeWithNameDefaults(defaults, nameOrSchema, maybeSchema);
  }

  return Object.freeze(
    fields.prefix === undefined
      ? { namespaceUri: fields.namespaceUri, Element, Attribute }
      : { namespaceUri: fields.namespaceUri, prefix: fields.prefix, Element, Attribute },
  );
};
