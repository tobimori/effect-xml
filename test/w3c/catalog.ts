import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import * as Schema from "effect/Schema";

const CatalogTestSchema = Schema.Struct({
  id: Schema.String,
  uri: Schema.String,
  path: Schema.String,
  catalogPath: Schema.String,
  type: Schema.Literals(["valid", "invalid", "not-wf", "error"]),
  entities: Schema.Literals(["both", "none", "parameter", "general"]),
  recommendation: Schema.String,
  version: Schema.Union([Schema.String, Schema.Null]),
  edition: Schema.Union([Schema.String, Schema.Null]),
  namespace: Schema.Literals(["yes", "no"]),
  sections: Schema.String,
  description: Schema.String,
  profiles: Schema.Array(Schema.String),
});

export type CatalogTest = Schema.Schema.Type<typeof CatalogTestSchema>;

const CatalogFixupSchema = Schema.Struct({
  id: Schema.String,
  from: Schema.String,
  to: Schema.String,
  reason: Schema.String,
});

const CatalogSchema = Schema.Struct({
  catalog: Schema.String,
  testCount: Schema.Number,
  catalogFixups: Schema.Array(CatalogFixupSchema),
  tests: Schema.Array(CatalogTestSchema),
});

const InventoryFileSchema = Schema.Struct({
  path: Schema.String,
  sha256: Schema.String,
});

const InventorySchema = Schema.Struct({
  fileCount: Schema.Number,
  files: Schema.Array(InventoryFileSchema),
});

export interface LoadedCatalog {
  readonly tests: ReadonlyArray<CatalogTest>;
  readonly fixturePaths: ReadonlyMap<string, string>;
}

const EXPECTED_TEST_COUNT = 2_585;
const EXPECTED_FIXUP_COUNT = 9;
const EXPECTED_FILE_COUNT = 3_386;

const pathEscapes = (root: string, path: string) => {
  const relativePath = relative(root, path);

  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
};

const portableRelative = (root: string, path: string) => relative(root, path).split(sep).join("/");

const compareStrings = (left: string, right: string) => {
  if (left < right) return -1;
  if (left > right) return 1;

  return 0;
};

const listFiles = (root: string) => {
  const directories = [""];
  const files: Array<string> = [];

  while (directories.length > 0) {
    const directory = directories.pop();

    if (directory === undefined) continue;

    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const relativePath = directory === "" ? entry.name : `${directory}/${entry.name}`;

      if (entry.isDirectory()) {
        directories.push(relativePath);
      } else {
        files.push(relativePath);
      }
    }
  }

  return files.sort(compareStrings);
};

const sha256 = (contents: Uint8Array) => createHash("sha256").update(contents).digest("hex");

export const loadCatalog = (): LoadedCatalog => {
  const helperDirectory = dirname(fileURLToPath(import.meta.url));
  const fixtureDirectory = realpathSync(resolve(helperDirectory, "../fixtures/w3c/xmlconf"));
  const catalogPath = resolve(helperDirectory, "../fixtures/w3c/catalog.json");
  const inventoryPath = resolve(helperDirectory, "../fixtures/w3c/inventory.json");

  const catalogInput: unknown = JSON.parse(readFileSync(catalogPath, "utf8"));
  const inventoryInput: unknown = JSON.parse(readFileSync(inventoryPath, "utf8"));
  const catalog = Schema.decodeUnknownSync(CatalogSchema)(catalogInput);
  const inventory = Schema.decodeUnknownSync(InventorySchema)(inventoryInput);

  if (
    inventory.fileCount !== EXPECTED_FILE_COUNT ||
    inventory.files.length !== EXPECTED_FILE_COUNT
  ) {
    throw new Error(
      `expected ${EXPECTED_FILE_COUNT} W3C corpus files, ` +
        `found ${inventory.fileCount}/${inventory.files.length}`,
    );
  }

  const inventoryPaths = new Set<string>();
  let previousInventoryPath: string | undefined;

  for (const file of inventory.files) {
    const fixturePath = resolve(fixtureDirectory, file.path);

    if (
      pathEscapes(fixtureDirectory, fixturePath) ||
      portableRelative(fixtureDirectory, fixturePath) !== file.path
    ) {
      throw new Error(`W3C inventory path escapes or is not normalized: ${file.path}`);
    }

    if (inventoryPaths.has(file.path)) {
      throw new Error(`duplicate W3C inventory path: ${file.path}`);
    }

    if (previousInventoryPath !== undefined && previousInventoryPath > file.path) {
      throw new Error(`W3C inventory paths are not sorted: ${file.path}`);
    }

    if (!statSync(fixturePath).isFile()) {
      throw new Error(`W3C inventory entry is not a file: ${file.path}`);
    }

    const realFixturePath = realpathSync(fixturePath);

    if (pathEscapes(fixtureDirectory, realFixturePath)) {
      throw new Error(`W3C inventory entry resolves outside the corpus: ${file.path}`);
    }

    const actualHash = sha256(readFileSync(realFixturePath));

    if (actualHash !== file.sha256) {
      throw new Error(`W3C inventory hash mismatch: ${file.path}`);
    }

    inventoryPaths.add(file.path);
    previousInventoryPath = file.path;
  }

  const actualFiles = listFiles(fixtureDirectory);

  if (
    actualFiles.length !== inventory.files.length ||
    actualFiles.some((path, index) => path !== inventory.files[index]?.path)
  ) {
    throw new Error("W3C corpus file list does not match its inventory");
  }

  if (catalog.catalog !== "xmlconf.xml") {
    throw new Error(`unexpected W3C catalog entry point: ${catalog.catalog}`);
  }

  if (catalog.testCount !== EXPECTED_TEST_COUNT || catalog.tests.length !== EXPECTED_TEST_COUNT) {
    throw new Error(
      `expected ${EXPECTED_TEST_COUNT} W3C catalog tests, ` +
        `found ${catalog.testCount}/${catalog.tests.length}`,
    );
  }

  if (catalog.catalogFixups.length !== EXPECTED_FIXUP_COUNT) {
    throw new Error(
      `expected ${EXPECTED_FIXUP_COUNT} catalog path fixups, ` +
        `found ${catalog.catalogFixups.length}`,
    );
  }

  const testsById = new Map(catalog.tests.map((test) => [test.id, test]));
  const remappedTests = catalog.tests.filter((test) => test.path !== test.catalogPath);
  const fixupIds = new Set<string>();

  if (testsById.size !== EXPECTED_TEST_COUNT) {
    throw new Error("W3C catalog contains duplicate test IDs");
  }

  if (remappedTests.length !== EXPECTED_FIXUP_COUNT) {
    throw new Error(
      `expected ${EXPECTED_FIXUP_COUNT} remapped fixture paths, found ${remappedTests.length}`,
    );
  }

  for (const fixup of catalog.catalogFixups) {
    const test = testsById.get(fixup.id);

    if (fixupIds.has(fixup.id)) {
      throw new Error(`duplicate W3C catalog path fixup: ${fixup.id}`);
    }

    if (test === undefined || test.catalogPath !== fixup.from || test.path !== fixup.to) {
      throw new Error(`W3C catalog path fixup does not match its test metadata: ${fixup.id}`);
    }

    fixupIds.add(fixup.id);
  }

  readFileSync(resolve(fixtureDirectory, catalog.catalog));

  const fixturePaths = new Map<string, string>();

  for (const test of catalog.tests) {
    const fixturePath = resolve(fixtureDirectory, test.path);

    if (pathEscapes(fixtureDirectory, fixturePath)) {
      throw new Error(`W3C fixture path escapes the corpus: ${test.id} (${test.path})`);
    }

    if (!statSync(fixturePath).isFile()) {
      throw new Error(`W3C fixture is not a file: ${test.id} (${test.path})`);
    }

    const realFixturePath = realpathSync(fixturePath);

    if (pathEscapes(fixtureDirectory, realFixturePath)) {
      throw new Error(`W3C fixture resolves outside the corpus: ${test.id} (${test.path})`);
    }

    fixturePaths.set(test.id, realFixturePath);
  }

  return { tests: catalog.tests, fixturePaths };
};
