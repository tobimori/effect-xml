import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { Attribute as AttributeNode, isAttribute } from "../ast/attribute.ts";
import { Name as AstName } from "../ast/name.ts";
import { isName, type Name } from "../namespace/name.ts";
import {
  astNameFields,
  codecNameFrom,
  codecNameLabel,
  hasExpandedName,
  resolvedCodecName,
  type CodecName,
} from "./codec-name.ts";
import { PlacementBindings, resolvePlacementName } from "./context.ts";
import { encoded, type PlacementToken } from "./metadata.ts";
import { scalar, validateXmlCharacters } from "./scalar.ts";

const resolveName = (explicitName: CodecName, token: PlacementToken) => {
  const ownName = resolvedCodecName(explicitName);
  return Effect.map(PlacementBindings, (scope) => ownName ?? resolvePlacementName(scope, token));
};

/** Places a scalar schema in an XML attribute. */
export function Attribute<S extends Schema.Constraint>(
  schema: S,
): Schema.Codec<S["Type"], AttributeNode, S["DecodingServices"], S["EncodingServices"]>;
export function Attribute<S extends Schema.Constraint>(
  name: string | Name,
  schema: S,
): Schema.Codec<S["Type"], AttributeNode, S["DecodingServices"], S["EncodingServices"]>;
// RETURN TYPE: The overload implementation preserves the supplied schema's service sets.
export function Attribute<S extends Schema.Constraint>(
  nameOrSchema: string | Name | S,
  maybeSchema?: S,
): Schema.Codec<S["Type"], AttributeNode, S["DecodingServices"], S["EncodingServices"]> {
  return makeAttribute({}, nameOrSchema, maybeSchema);
}

/** @internal Builds a namespace-factory attribute without changing the public constructor. */
// RETURN TYPE: Preserves the supplied schema's service sets through the private defaults.
export const attributeWithNameDefaults = <S extends Schema.Constraint>(
  defaults: CodecName,
  nameOrSchema: string | S,
  maybeSchema?: S,
): Schema.Codec<S["Type"], AttributeNode, S["DecodingServices"], S["EncodingServices"]> =>
  makeAttribute(defaults, nameOrSchema, maybeSchema);

// RETURN TYPE: The helper preserves the selected scalar schema's service sets.
const makeAttribute = <S extends Schema.Constraint>(
  defaults: CodecName,
  nameOrSchema: string | Name | S,
  maybeSchema?: S,
): Schema.Codec<S["Type"], AttributeNode, S["DecodingServices"], S["EncodingServices"]> => {
  const named = Predicate.isString(nameOrSchema) || isName(nameOrSchema);
  const explicitName = codecNameFrom(named ? nameOrSchema : undefined, defaults);
  const schema = named ? maybeSchema! : nameOrSchema;
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
            if (hasExpandedName(attribute.name, name)) return Effect.succeed(attribute.value);
            return Effect.fail(
              new SchemaIssue.InvalidValue(
                { message: `Expected XML attribute ${JSON.stringify(codecNameLabel(name))}` },
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
                    new AttributeNode({
                      name: new AstName(astNameFields(name)),
                      value: valid,
                    }),
                ),
          ),
      }),
    ),
  );
};
