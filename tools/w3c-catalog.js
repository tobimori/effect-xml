#!/usr/bin/env node
// Regenerate with: vp node tools/w3c-catalog.js

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as SchemaParser from "effect/SchemaParser";

import * as Xml from "../src/xml.ts";
import * as XmlNode from "../src/xml-node.ts";

const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const EXPECTED_TEST_COUNT = 2_585;
const EXPECTED_FILE_COUNT = 3_386;
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_ROOT = resolve(REPOSITORY_ROOT, "test/fixtures/w3c/xmlconf");
const CATALOG_OUTPUT = resolve(REPOSITORY_ROOT, "test/fixtures/w3c/catalog.json");
const INVENTORY_OUTPUT = resolve(REPOSITORY_ROOT, "test/fixtures/w3c/inventory.json");

const CATALOG_PATH_FIXUPS = new Map([
  ["hst-bh-001", ["eduni/namespaces/misc/001.xml", "eduni/misc/001.xml"]],
  ["hst-bh-002", ["eduni/namespaces/misc/002.xml", "eduni/misc/002.xml"]],
  ["hst-bh-003", ["eduni/namespaces/misc/003.xml", "eduni/misc/003.xml"]],
  ["hst-bh-004", ["eduni/namespaces/misc/004.xml", "eduni/misc/004.xml"]],
  ["hst-bh-005", ["eduni/namespaces/misc/005.xml", "eduni/misc/005.xml"]],
  ["hst-bh-006", ["eduni/namespaces/misc/006.xml", "eduni/misc/006.xml"]],
  ["hst-lhs-007", ["eduni/namespaces/misc/007.xml", "eduni/misc/007.xml"]],
  ["hst-lhs-008", ["eduni/namespaces/misc/008.xml", "eduni/misc/008.xml"]],
  ["hst-lhs-009", ["eduni/namespaces/misc/009.xml", "eduni/misc/009.xml"]],
]);

const FIXUP_REASON = "catalog xml:base typo; external entity and fixtures are under eduni/misc";

const getAttribute = (element, localName, namespaceUri) => {
  for (const attribute of element.attributes) {
    if (attribute.name.localName === localName && attribute.name.namespaceUri === namespaceUri) {
      return attribute.value;
    }
  }

  return undefined;
};

const requiredAttribute = (element, localName) => {
  const value = getAttribute(element, localName, undefined);

  if (value === undefined) {
    throw new Error(`${element.name.localName} is missing required attribute ${localName}`);
  }

  return value;
};

const joinBase = (base, relative) => {
  if (relative === undefined || relative.length === 0) return base;

  const joined = posix.normalize(posix.join(base, relative));

  return joined === "." ? "" : `${joined.replace(/\/+$/u, "")}/`;
};

const description = (element) => {
  let text = "";

  XmlNode.walk(element, (node) => {
    if (XmlNode.isText(node) || XmlNode.isCData(node)) text += node.value;
  });

  return text.trim().split(/\s+/u).join(" ");
};

const compareStrings = (left, right) => {
  if (left < right) return -1;
  if (left > right) return 1;

  return 0;
};

const listFiles = (root) => {
  const directories = [""];
  const files = [];

  while (directories.length > 0) {
    const directory = directories.pop();

    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const relativePath = directory === "" ? entry.name : `${directory}/${entry.name}`;

      if (entry.isDirectory()) {
        directories.push(relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      } else {
        throw new Error(`unsupported W3C corpus entry: ${relativePath}`);
      }
    }
  }

  return files.sort(compareStrings);
};

const sha256 = (contents) => createHash("sha256").update(contents).digest("hex");

const catalogPath = resolve(CORPUS_ROOT, "xmlconf.xml");
const expandedCatalog = execFileSync(
  "xmllint",
  ["--nonet", "--loaddtd", "--dtdattr", "--noent", "--dropdtd", catalogPath],
  {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  },
);
const document = SchemaParser.decodeSync(Xml.DocumentNode())(expandedCatalog);
const tests = [];
const appliedFixups = [];

const visit = (element, base, profiles) => {
  const nextBase = joinBase(base, getAttribute(element, "base", XML_NAMESPACE));
  const profile = getAttribute(element, "PROFILE", undefined);
  const nextProfiles = profile === undefined ? profiles : [...profiles, profile];

  if (element.name.localName === "TEST") {
    const id = requiredAttribute(element, "ID");
    const uri = requiredAttribute(element, "URI");
    const sourcePath = posix.normalize(posix.join(nextBase, uri));
    const fixup = CATALOG_PATH_FIXUPS.get(id);
    let path = sourcePath;

    if (fixup !== undefined) {
      const [expectedCatalogPath, fixedPath] = fixup;

      if (sourcePath !== expectedCatalogPath) {
        throw new Error(`catalog path for ${id} changed: ${sourcePath}`);
      }

      path = fixedPath;
      appliedFixups.push({
        id,
        from: sourcePath,
        to: path,
        reason: FIXUP_REASON,
      });
    }

    tests.push({
      id,
      uri,
      path,
      catalogPath: sourcePath,
      type: requiredAttribute(element, "TYPE"),
      entities: getAttribute(element, "ENTITIES", undefined) ?? "none",
      recommendation: getAttribute(element, "RECOMMENDATION", undefined) ?? "XML1.0",
      version: getAttribute(element, "VERSION", undefined) ?? null,
      edition: getAttribute(element, "EDITION", undefined) ?? null,
      namespace: getAttribute(element, "NAMESPACE", undefined) ?? "yes",
      sections: requiredAttribute(element, "SECTIONS"),
      description: description(element),
      profiles: nextProfiles,
    });

    return;
  }

  for (const child of element.children) {
    if (XmlNode.isElement(child)) visit(child, nextBase, nextProfiles);
  }
};

visit(document.root, "", []);

const ids = new Set();
const duplicateIds = new Set();

for (const test of tests) {
  if (ids.has(test.id)) duplicateIds.add(test.id);
  ids.add(test.id);
}

if (duplicateIds.size > 0) {
  throw new Error(`duplicate TEST IDs: ${JSON.stringify([...duplicateIds].sort(compareStrings))}`);
}

if (tests.length !== EXPECTED_TEST_COUNT) {
  throw new Error(`expected ${EXPECTED_TEST_COUNT} TEST entries, found ${tests.length}`);
}

const expectedFixupIds = [...CATALOG_PATH_FIXUPS.keys()].sort(compareStrings);
const appliedFixupIds = [...new Set(appliedFixups.map((fixup) => fixup.id))].sort(compareStrings);

if (JSON.stringify(appliedFixupIds) !== JSON.stringify(expectedFixupIds)) {
  throw new Error(
    `catalog fixups changed: expected ${JSON.stringify(expectedFixupIds)}, ` +
      `applied ${JSON.stringify(appliedFixupIds)}`,
  );
}

const manifest = {
  catalog: "xmlconf.xml",
  testCount: tests.length,
  catalogFixups: appliedFixups,
  tests,
};

const inventoryFiles = listFiles(CORPUS_ROOT).map((relativePath) => ({
  path: relativePath,
  sha256: sha256(readFileSync(resolve(CORPUS_ROOT, relativePath))),
}));

if (inventoryFiles.length !== EXPECTED_FILE_COUNT) {
  throw new Error(`expected ${EXPECTED_FILE_COUNT} corpus files, found ${inventoryFiles.length}`);
}

const inventory = {
  fileCount: inventoryFiles.length,
  files: inventoryFiles,
};

writeFileSync(CATALOG_OUTPUT, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
writeFileSync(INVENTORY_OUTPUT, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
