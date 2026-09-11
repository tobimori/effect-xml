import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import * as Xml from "../src/xml.ts";
import { loadCatalog, type CatalogTest } from "./w3c/catalog.ts";
import { projectDocument } from "./w3c/semantic-projection.ts";
import { selectStringProfile, skipReasons, type SkipReason } from "./w3c/string-profile.ts";

const EXPECTED_APPLICABLE_COUNT = 384;
const EXPECTED_ACCEPTED_COUNT = 76;
const EXPECTED_REJECTED_COUNT = 308;
const EXPECTED_EXCLUDED_COUNT = 2_201;

const expectedSkipCounts = new Map<SkipReason, number>([
  [skipReasons.typeError, 33],
  [skipReasons.otherEdition, 312],
  [skipReasons.namespacesDisabled, 14],
  [skipReasons.byteInput, 27],
  [skipReasons.doctype, 1_511],
  [skipReasons.doctypeEntities, 304],
]);

const catalog = loadCatalog();
const profile = selectStringProfile(catalog.tests, catalog.fixturePaths);
const excludedCount = Array.from(profile.excluded.values()).reduce(
  (total, cases) => total + cases.length,
  0,
);

if (
  profile.accepted.length !== EXPECTED_ACCEPTED_COUNT ||
  profile.rejected.length !== EXPECTED_REJECTED_COUNT ||
  profile.accepted.length + profile.rejected.length !== EXPECTED_APPLICABLE_COUNT ||
  excludedCount !== EXPECTED_EXCLUDED_COUNT
) {
  throw new Error(
    `unexpected W3C profile counts: accepted=${profile.accepted.length}, ` +
      `rejected=${profile.rejected.length}, excluded=${excludedCount}`,
  );
}

for (const [reason, expectedCount] of expectedSkipCounts) {
  const actualCount = profile.excluded.get(reason)?.length ?? 0;

  if (actualCount !== expectedCount) {
    throw new Error(
      `unexpected W3C exclusion count for ${reason}: ` +
        `expected ${expectedCount}, found ${actualCount}`,
    );
  }
}

for (const reason of profile.excluded.keys()) {
  if (!expectedSkipCounts.has(reason)) {
    throw new Error(`unexpected W3C exclusion reason: ${reason}`);
  }
}

const documentCodec = Xml.DocumentNode({
  pretty: false,
  limits: {
    inputLength: 2_000_000,
    depth: 20_000,
    nodes: 1_000_000,
    attributesPerElement: 100_000,
    textLength: 2_000_000,
  },
});

const testName = (test: CatalogTest) => `${test.id}: ${test.description}`;

describe("W3C XML conformance: namespace-aware nonvalidating string API profile", () => {
  describe("required acceptance and semantic raw round trip", () => {
    for (const applicable of profile.accepted) {
      it(testName(applicable.test), () => {
        const decoded = Schema.decodeUnknownResult(documentCodec)(applicable.source);

        if (Result.isFailure(decoded)) {
          throw new Error(`${applicable.test.id} should be accepted: ${decoded.failure.message}`);
        }

        const encoded = Schema.encodeUnknownResult(documentCodec)(decoded.success);

        if (Result.isFailure(encoded)) {
          throw new Error(`${applicable.test.id} should round-trip: ${encoded.failure.message}`);
        }

        const reparsed = Schema.decodeUnknownResult(documentCodec)(encoded.success);

        if (Result.isFailure(reparsed)) {
          throw new Error(
            `${applicable.test.id} serialized to rejected XML: ${reparsed.failure.message}`,
          );
        }

        const before = projectDocument(decoded.success);
        const after = projectDocument(reparsed.success);

        expect(after).toEqual(before);
      });
    }
  });

  describe("required rejection", () => {
    for (const applicable of profile.rejected) {
      it(testName(applicable.test), () => {
        const decoded = Schema.decodeUnknownResult(documentCodec)(applicable.source);

        if (Result.isSuccess(decoded)) {
          throw new Error(`${applicable.test.id} should be rejected as not well-formed`);
        }

        const issue = decoded.failure.issue;

        if (!Predicate.isTagged("Encoding")(issue)) {
          throw new Error(`${applicable.test.id} returned an unexpected schema issue`);
        }

        expect(Predicate.isTagged("InvalidValue")(issue.issue)).toBe(true);
        expect(decoded.failure.message).not.toContain("RangeError");
      });
    }
  });

  for (const [reason, cases] of profile.excluded) {
    describe(`excluded: ${reason}`, () => {
      for (const test of cases) {
        it.skip(testName(test), () => {});
      }
    });
  }
});
