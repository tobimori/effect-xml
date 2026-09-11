import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { Attribute as AttributeNode, isAttribute } from "../ast/attribute.ts";
import { Name } from "../ast/name.ts";
import { PlacementBindings, resolvePlacementName } from "./context.ts";
import { encoded, type PlacementToken } from "./metadata.ts";
import { scalar, validateXmlCharacters } from "./scalar.ts";

const resolveName = (explicitName: string | undefined, token: PlacementToken) =>
  Effect.map(PlacementBindings, (scope) => explicitName ?? resolvePlacementName(scope, token));

/** Places a scalar schema in an XML attribute. */
export function Attribute<S extends Schema.Constraint>(
  schema: S,
): Schema.Codec<S["Type"], AttributeNode, S["DecodingServices"], S["EncodingServices"]>;
export function Attribute<S extends Schema.Constraint>(
  name: string,
  schema: S,
): Schema.Codec<S["Type"], AttributeNode, S["DecodingServices"], S["EncodingServices"]>;
// RETURN TYPE: The overload implementation preserves the supplied schema's service sets.
export function Attribute<S extends Schema.Constraint>(
  nameOrSchema: string | S,
  maybeSchema?: S,
): Schema.Codec<S["Type"], AttributeNode, S["DecodingServices"], S["EncodingServices"]> {
  const explicitName = Predicate.isString(nameOrSchema) ? nameOrSchema : undefined;
  const schema = Predicate.isString(nameOrSchema) ? maybeSchema! : nameOrSchema;
  const token: PlacementToken = {};
  const node = encoded(isAttribute, { kind: "attribute", name: explicitName, token });

  return node.pipe(
    Schema.decodeTo(
      scalar(schema),
      SchemaTransformation.transformEffect({
        decode: (attribute, options) =>
          Effect.flatMap(resolveName(explicitName, token), (name) => {
            if (name === undefined) {
              return Effect.fail(
                new SchemaIssue.InvalidValue(
                  { message: "A name-less XML attribute must be used as an Xml.Struct field" },
                  attribute,
                  options,
                ),
              );
            }
            if (attribute.name.localName === name && attribute.name.namespaceUri === undefined) {
              return Effect.succeed(attribute.value);
            }
            return Effect.fail(
              new SchemaIssue.InvalidValue(
                { message: `Expected XML attribute ${JSON.stringify(name)}` },
                attribute,
                options,
              ),
            );
          }),
        encode: (value, options) =>
          Effect.flatMap(resolveName(explicitName, token), (name) =>
            name === undefined
              ? Effect.fail(
                  new SchemaIssue.InvalidValue(
                    { message: "A name-less XML attribute must be used as an Xml.Struct field" },
                    value,
                    options,
                  ),
                )
              : Effect.map(
                  validateXmlCharacters(value, "XML attribute value", options),
                  (valid) =>
                    new AttributeNode({ name: new Name({ localName: name }), value: valid }),
                ),
          ),
      }),
    ),
  );
}
