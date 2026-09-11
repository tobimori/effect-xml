import { defineConfig } from "vite-plus";

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
    entry: "src/index.ts",
    platform: "neutral",
    unbundle: true,
    dts: {
      tsgo: true,
    },
    exports: true,
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
