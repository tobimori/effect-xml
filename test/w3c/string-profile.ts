import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { TextDecoder } from "node:util";

import type { CatalogTest } from "./catalog.ts";

export const skipReasons = {
  typeError: "TYPE=error has no required outcome",
  unsupportedVersion: "XML version is outside the XML 1.0 / XML 1.1 profile",
  otherEdition: "XML edition is outside XML 1.0 Fifth / XML 1.1 Second",
  namespacesDisabled: "namespace processing would have to be disabled",
  byteInput: "raw-byte case is outside the JavaScript-string API profile",
  doctype: "DOCTYPE is unsupported",
  doctypeEntities: "DOCTYPE with entities is unsupported",
  externalEntities: "external entities are unsupported",
} as const;

export type SkipReason = (typeof skipReasons)[keyof typeof skipReasons];

export interface ApplicableCase {
  readonly test: CatalogTest;
  readonly source: string;
}

export interface StringProfile {
  readonly accepted: ReadonlyArray<ApplicableCase>;
  readonly rejected: ReadonlyArray<ApplicableCase>;
  readonly excluded: ReadonlyMap<SkipReason, ReadonlyArray<CatalogTest>>;
}

class ByteProfileExclusion extends Error {}

const expectedByteExclusionIds = new Set([
  "not-wf-sa-168",
  "not-wf-sa-169",
  "not-wf-sa-170",
  "ibm-not-wf-P02-ibm02n30.xml",
  "ibm-not-wf-P02-ibm02n31.xml",
  "ibm-1-1-not-wf-P02-ibm02n58.xml",
  "ibm-1-1-not-wf-P02-ibm02n67.xml",
  "ibm-1-1-not-wf-P04-ibm04n21.xml",
  "ibm-1-1-not-wf-P04-ibm04n22.xml",
  "ibm-1-1-not-wf-P04-ibm04n23.xml",
  "ibm-1-1-not-wf-P04-ibm04n24.xml",
  "ibm-1-1-not-wf-P04a-ibm04an21.xml",
  "ibm-1-1-not-wf-P04a-ibm04an22.xml",
  "ibm-1-1-not-wf-P04a-ibm04an23.xml",
  "ibm-1-1-not-wf-P04a-ibm04an24.xml",
  "rmt-e2e-27",
  "x-ibm-1-0.5-not-wf-P04-ibm04n21.xml",
  "x-ibm-1-0.5-not-wf-P04-ibm04n22.xml",
  "x-ibm-1-0.5-not-wf-P04-ibm04n23.xml",
  "x-ibm-1-0.5-not-wf-P04-ibm04n24.xml",
  "x-ibm-1-0.5-not-wf-P04a-ibm04an21.xml",
  "x-ibm-1-0.5-not-wf-P04a-ibm04an22.xml",
  "x-ibm-1-0.5-not-wf-P04a-ibm04an23.xml",
  "x-ibm-1-0.5-not-wf-P04a-ibm04an24.xml",
  "hst-lhs-007",
  "hst-lhs-008",
  "hst-lhs-009",
]);

const declaredEncodingFrom = (source: string) => {
  const declaration = source.slice(0, 512).match(/^<\?xml\s[\s\S]*?\?>/u)?.[0];

  if (declaration === undefined) return undefined;

  return declaration.match(/\sencoding\s*=\s*(['"])([A-Za-z][A-Za-z0-9._-]*)\1/u)?.[2];
};

const hasCompatibleSignature = (signature: string, declared: string) => {
  const normalized = declared.toLowerCase().replaceAll("_", "-");

  if (signature === "utf-8") return normalized === "utf-8";

  if (signature === "utf-16le") {
    return normalized === "utf-16" || normalized === "utf-16le";
  }

  if (signature === "utf-16be") {
    return normalized === "utf-16" || normalized === "utf-16be";
  }

  return false;
};

const decodeXml = (bytes: Buffer) => {
  let signature: string | undefined;

  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    signature = "utf-8";
  } else if (bytes.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0xfe, 0xff]))) {
    throw new ByteProfileExclusion("unsupported XML byte encoding signature: UTF-32BE");
  } else if (bytes.subarray(0, 4).equals(Buffer.from([0xff, 0xfe, 0x00, 0x00]))) {
    throw new ByteProfileExclusion("unsupported XML byte encoding signature: UTF-32LE");
  } else if (bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) {
    signature = "utf-16be";
  } else if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) {
    signature = "utf-16le";
  } else if (bytes.subarray(0, 4).equals(Buffer.from([0x00, 0x3c, 0x00, 0x3f]))) {
    signature = "utf-16be";
  } else if (bytes.subarray(0, 4).equals(Buffer.from([0x3c, 0x00, 0x3f, 0x00]))) {
    signature = "utf-16le";
  } else if (bytes.subarray(0, 4).equals(Buffer.from([0x4c, 0x6f, 0xa7, 0x94]))) {
    throw new ByteProfileExclusion("unsupported XML byte encoding signature: EBCDIC");
  }

  const probeEncoding = signature ?? "windows-1252";
  let probe: string;

  try {
    probe = new TextDecoder(probeEncoding, { fatal: true }).decode(bytes.subarray(0, 1_024), {
      stream: true,
    });
  } catch (cause) {
    throw new ByteProfileExclusion(
      `cannot inspect XML bytes as ${probeEncoding}: ${String(cause)}`,
    );
  }

  const declaredEncoding = declaredEncodingFrom(probe);

  if (
    signature !== undefined &&
    declaredEncoding !== undefined &&
    !hasCompatibleSignature(signature, declaredEncoding)
  ) {
    throw new ByteProfileExclusion(
      `XML byte signature ${signature} conflicts with declared encoding ${declaredEncoding}`,
    );
  }

  const encoding = signature ?? declaredEncoding ?? "utf-8";
  const normalizedEncoding = encoding.toLowerCase().replaceAll("_", "-");
  const declaresAscii = normalizedEncoding === "ascii" || normalizedEncoding === "us-ascii";

  if (declaresAscii && bytes.some((byte) => byte > 0x7f)) {
    throw new ByteProfileExclusion("non-ASCII byte in an XML entity declared as ASCII");
  }

  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new ByteProfileExclusion(`cannot decode XML bytes as ${encoding}: ${String(cause)}`);
  }
};

const containsDoctype = (source: string) => {
  let index = 0;

  while (index < source.length) {
    const opening = source.indexOf("<", index);

    if (opening < 0) return false;

    let skippedClosing: string | undefined;

    if (source.startsWith("<!--", opening)) {
      skippedClosing = "-->";
    } else if (source.startsWith("<?", opening)) {
      skippedClosing = "?>";
    } else if (source.startsWith("<![CDATA[", opening)) {
      skippedClosing = "]]>";
    }

    if (skippedClosing !== undefined) {
      const closing = source.indexOf(skippedClosing, opening + 2);

      if (closing < 0) return false;

      index = closing + skippedClosing.length;
      continue;
    }

    if (source.startsWith("<!DOCTYPE", opening)) {
      const following = source[opening + "<!DOCTYPE".length];
      const isXmlWhitespace =
        following === " " || following === "\t" || following === "\n" || following === "\r";

      if (following === ">" || isXmlWhitespace) return true;
    }

    if (source[opening + 1] !== "!") {
      let quote: '"' | "'" | undefined;
      let cursor = opening + 1;

      for (; cursor < source.length; cursor++) {
        const character = source[cursor];

        if (quote === undefined && (character === '"' || character === "'")) {
          quote = character;
        } else if (character === quote) {
          quote = undefined;
        } else if (quote === undefined && character === ">") {
          break;
        }
      }

      if (cursor === source.length) return false;

      index = cursor + 1;
      continue;
    }

    index = opening + 1;
  }

  return false;
};

const exclude = (
  excluded: Map<SkipReason, Array<CatalogTest>>,
  test: CatalogTest,
  reason: SkipReason,
) => {
  const cases = excluded.get(reason);

  if (cases === undefined) {
    excluded.set(reason, [test]);
  } else {
    cases.push(test);
  }
};

export const selectStringProfile = (
  tests: ReadonlyArray<CatalogTest>,
  fixturePaths: ReadonlyMap<string, string>,
): StringProfile => {
  const accepted: Array<ApplicableCase> = [];
  const rejected: Array<ApplicableCase> = [];
  const excluded = new Map<SkipReason, Array<CatalogTest>>();
  const catalogIds = new Set(tests.map((test) => test.id));

  if (expectedByteExclusionIds.size !== 27) {
    throw new Error(`expected 27 raw-byte exclusions, found ${expectedByteExclusionIds.size}`);
  }

  for (const id of expectedByteExclusionIds) {
    if (!catalogIds.has(id)) {
      throw new Error(`raw-byte exclusion is absent from the W3C catalog: ${id}`);
    }
  }

  for (const test of tests) {
    if (test.type === "error") {
      exclude(excluded, test, skipReasons.typeError);
      continue;
    }

    if (test.version !== null) {
      const versions = test.version.split(/\s+/u);
      const supportsVersion = versions.includes("1.0") || versions.includes("1.1");

      if (!supportsVersion) {
        exclude(excluded, test, skipReasons.unsupportedVersion);
        continue;
      }
    }

    if (test.edition !== null) {
      const currentEdition = test.version === "1.1" ? "2" : "5";
      const editions = test.edition.split(/\s+/u);

      if (!editions.includes(currentEdition)) {
        exclude(excluded, test, skipReasons.otherEdition);
        continue;
      }
    }

    if (test.namespace === "no") {
      exclude(excluded, test, skipReasons.namespacesDisabled);
      continue;
    }

    const fixturePath = fixturePaths.get(test.id);

    if (fixturePath === undefined) {
      throw new Error(`validated W3C fixture path was lost: ${test.id}`);
    }

    const bytes = readFileSync(fixturePath);
    let source: string;

    try {
      source = decodeXml(bytes);
    } catch (cause) {
      if (!(cause instanceof ByteProfileExclusion)) {
        throw cause;
      }

      if (!expectedByteExclusionIds.has(test.id)) {
        throw new Error(`unexpected byte decoding exclusion for ${test.id}`, { cause });
      }

      exclude(excluded, test, skipReasons.byteInput);
      continue;
    }

    if (expectedByteExclusionIds.has(test.id)) {
      throw new Error(`expected raw-byte exclusion now decodes as a string: ${test.id}`);
    }

    if (containsDoctype(source)) {
      const reason = test.entities === "none" ? skipReasons.doctype : skipReasons.doctypeEntities;

      exclude(excluded, test, reason);
      continue;
    }

    if (test.entities !== "none") {
      exclude(excluded, test, skipReasons.externalEntities);
      continue;
    }

    const applicable = { test, source };

    if (test.type === "not-wf") {
      rejected.push(applicable);
    } else {
      accepted.push(applicable);
    }
  }

  return { accepted, rejected, excluded };
};
