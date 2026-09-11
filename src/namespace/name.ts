import * as Schema from "effect/Schema";

import { isNcName } from "../parser/character.ts";
import { validateBinding, xmlnsNamespace } from "./validation.ts";

const nameTypeId = Symbol("effect-xml/Xml/Name");
const nameIdentity: typeof nameTypeId = nameTypeId;

/** A validated expanded-name descriptor for typed XML codecs. */
export interface Name {
  readonly [nameTypeId]: typeof nameTypeId;
  readonly localName: string;
  readonly namespaceUri?: string;
  readonly prefix?: string;
}

const NameFields = Schema.Struct({
  localName: Schema.String,
  namespaceUri: Schema.optionalKey(Schema.String),
  prefix: Schema.optionalKey(Schema.String),
}).check(
  Schema.makeFilter((name) => {
    const issues: Array<Schema.FilterIssue> = [];

    if (!isNcName(name.localName)) {
      issues.push({ path: ["localName"], issue: "An XML local name must be an NCName" });
    }
    if (name.namespaceUri === "") {
      issues.push({
        path: ["namespaceUri"],
        issue: "A supplied namespace URI must not be empty",
      });
    }
    if (name.namespaceUri === xmlnsNamespace) {
      issues.push({
        path: ["namespaceUri"],
        issue: "The xmlns namespace name is reserved",
      });
    }
    if (name.prefix !== undefined) {
      if (name.namespaceUri === undefined) {
        issues.push({
          path: ["prefix"],
          issue: "A namespace prefix preference requires a namespace URI",
        });
      } else {
        const bindingIssue = validateBinding(name.prefix, name.namespaceUri);
        if (bindingIssue !== undefined) {
          issues.push({ path: ["prefix"], issue: bindingIssue });
        }
      }
    }

    return issues;
  }),
);

const isNameFields = Schema.is(NameFields);

/** Constructs a validated typed-codec name descriptor. */
export const Name = (
  localName: string,
  options?: { readonly namespaceUri?: string; readonly prefix?: string },
): Name => {
  const fields = NameFields.make({ ...options, localName });
  const name: Name = { [nameTypeId]: nameIdentity, ...fields };
  return Object.freeze(name);
};

/** Refines a value through the private typed-name identity and field validation. */
export const isName = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This guard is the Name recognition boundary.
  input: unknown,
): input is Name => isNameFields(input) && nameTypeId in input && input[nameTypeId] === nameTypeId;
