// @ts-expect-error The build config runs in Node while the package excludes Node ambient types
import { Buffer } from "node:buffer";
// @ts-expect-error The build config runs in Node while the package excludes Node ambient types
import { dirname, relative, resolve } from "node:path";
import { defineConfig, normalizePath, transformWithOxc } from "vite-plus";

const facadeEntries = ["src/index.ts", "src/xml.ts", "src/xml-node.ts"];
const resolvedFacadeEntries = new Set<string>();
const facadeTransforms = new Map<string, Awaited<ReturnType<typeof transformWithOxc>>>();

const ignoredPaths = [
  ".agent/**",
  ".agents/**",
  ".claude/**",
  ".codex/**",
  ".continue/**",
  ".cursor/**",
  ".docs/**",
  ".gemini/**",
  ".opencode/**",
  ".pi/**",
  ".playground/**",
  ".prototype/**",
  ".repos/**",
  ".roo/**",
  ".windsurf/**",
  "dist/**",
  "tools/oxlint/**",
];

export default defineConfig({
  pack: {
    entry: facadeEntries,
    platform: "neutral",
    unbundle: true,
    dts: {
      tsgo: true,
    },
    exports: false,
    plugins: [
      {
        name: "preserve-native-facade-exports",
        async buildStart() {
          resolvedFacadeEntries.clear();
          facadeTransforms.clear();
          for (const entry of facadeEntries) {
            const resolved = await this.resolve(entry);
            if (!resolved) this.error(`Could not resolve package facade ${entry}`);
            resolvedFacadeEntries.add(resolved.id);
          }
        },
        async renderChunk(_code, chunk, outputOptions) {
          const facade = chunk.facadeModuleId;
          if (
            outputOptions.format !== "es" ||
            !chunk.isEntry ||
            !facade ||
            !resolvedFacadeEntries.has(facade)
          ) {
            return null;
          }

          this.addWatchFile(facade);
          const source = await this.fs.readFile(facade, { encoding: "utf8" });
          const transformed = await transformWithOxc(source, facade, {
            typescript: { rewriteImportExtensions: true },
          });
          facadeTransforms.set(facade, transformed);
          if (outputOptions.sourcemap && transformed.map) {
            return { code: transformed.code, map: transformed.map };
          }
          return { code: transformed.code };
        },
        generateBundle(outputOptions, bundle) {
          if (!outputOptions.sourcemap || outputOptions.format !== "es") return;
          if (!outputOptions.dir) this.error("Facade source maps require an output directory");

          for (const chunk of Object.values(bundle)) {
            if (chunk.type !== "chunk" || !chunk.isEntry || !chunk.facadeModuleId) continue;
            const transformed = facadeTransforms.get(chunk.facadeModuleId);
            if (!transformed?.map) continue;

            const source = normalizePath(
              relative(dirname(resolve(outputOptions.dir, chunk.fileName)), chunk.facadeModuleId),
            );
            const map =
              chunk.map ??
              Object.assign(transformed.map, {
                file: chunk.fileName,
                sourcesContent: transformed.map.sourcesContent ?? [],
                toString() {
                  return JSON.stringify(this);
                },
                toUrl() {
                  return `data:application/json;charset=utf-8;base64,${Buffer.from(this.toString()).toString("base64")}`;
                },
              });
            map.mappings = transformed.map.mappings;
            map.names = transformed.map.names;
            map.sources = [source];
            chunk.map = map;

            if (outputOptions.sourcemap === "inline") {
              chunk.code = `${chunk.code.replace(/\n\/\/# sourceMappingURL=.*$/u, "")}\n//# sourceMappingURL=${map.toUrl()}`;
              continue;
            }

            const mapFileName = chunk.sourcemapFileName ?? `${chunk.fileName}.map`;
            const mapAsset = bundle[mapFileName];
            if (mapAsset) {
              if (mapAsset.type !== "asset")
                this.error(`Source map path ${mapFileName} is not an asset`);
              mapAsset.source = map.toString();
            } else {
              this.emitFile({ type: "asset", fileName: mapFileName, source: map.toString() });
            }

            if (outputOptions.sourcemap === true && !chunk.code.includes("//# sourceMappingURL=")) {
              chunk.code = `${chunk.code}\n//# sourceMappingURL=${mapFileName}`;
            }
          }
        },
      },
    ],
  },
  lint: {
    ignorePatterns: ignoredPaths,
    jsPlugins: [
      {
        name: "anti-slop",
        specifier: "./tools/oxlint/index.ts",
      },
      {
        name: "anti-slop-effect",
        specifier: "./tools/oxlint/effect/index.ts",
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-explicit-return-types": "error",
      "anti-slop/no-internal-export-all": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-manual-tags": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-nested-ternaries": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-switch-statements": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-returns": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-widen-then-assert": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",
      "anti-slop-effect/no-service-constructor-imports": "error",
      "anti-slop-effect/prefer-effect-fn": "error",
    },
  },
  fmt: {
    ignorePatterns: ignoredPaths,
  },
});
