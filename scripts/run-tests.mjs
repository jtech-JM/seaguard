#!/usr/bin/env node
/**
 * Test runner for `*.test.ts` suites under src/.
 *
 * The suites are plain `node:test` files, but Node cannot load `.ts` sources on
 * every host: distro builds are frequently compiled without TypeScript support
 * (ERR_NO_TYPESCRIPT) and older releases need --experimental-strip-types. So
 * rather than depend on the host Node build, transpile the first-party sources
 * with the TypeScript compiler that is already a devDependency, emit them to a
 * temp directory, and run `node --test` over the result.
 *
 * Usage:  node scripts/run-tests.mjs [pathFilter]
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");

/** Collect every first-party .ts/.tsx file, skipping generated + UI-only trees. */
const SKIP_DIRS = new Set(["components", "assets", "integrations", "routes"]);

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (dir === srcDir && SKIP_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), files);
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

/**
 * Rewrite module specifiers so plain Node ESM can resolve the emitted output:
 *   "@/lib/foo"  -> relative path + .js
 *   "./foo"      -> "./foo.js"
 * Bare package specifiers and node: builtins are left alone.
 */
function rewriteSpecifiers(code, fromFile) {
  const fromDir = path.dirname(fromFile);
  return code.replace(
    /(\bfrom\s*|\bimport\s*\(\s*)(["'])([^"']+)\2/g,
    (match, prefix, quote, spec) => {
      let resolved = spec;
      if (spec.startsWith("@/")) {
        const target = path.join(srcDir, spec.slice(2));
        resolved = path.relative(fromDir, target).replaceAll(path.sep, "/");
        if (!resolved.startsWith(".")) resolved = `./${resolved}`;
      } else if (!spec.startsWith(".")) {
        return match; // bare package or node: builtin
      }
      if (!/\.[cm]?js$/.test(resolved)) resolved += ".js";
      return `${prefix}${quote}${resolved}${quote}`;
    },
  );
}

const filter = process.argv[2];
const sources = (await walk(srcDir)).sort();
const testFiles = sources.filter((f) => /\.test\.tsx?$/.test(f));
const selected = filter ? testFiles.filter((f) => f.includes(filter)) : testFiles;

if (selected.length === 0) {
  console.error(filter ? `No test files matched "${filter}".` : "No test files found.");
  process.exit(1);
}

// Emit inside node_modules so bare specifiers (zod, @supabase/...) still
// resolve upward from the transpiled output. A temp dir outside the project
// cannot see the dependency tree.
const cacheRoot = path.join(root, "node_modules", ".cache");
mkdirSync(cacheRoot, { recursive: true });
const outDir = mkdtempSync(path.join(cacheRoot, "seaguard-tests-"));

try {
  for (const file of sources) {
    const source = await readFile(file, "utf8");
    const { outputText, diagnostics } = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        isolatedModules: true,
        verbatimModuleSyntax: false,
      },
      reportDiagnostics: true,
    });
    if (diagnostics?.length) {
      for (const d of diagnostics) {
        console.error(`${file}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
      }
    }
    const rel = path.relative(srcDir, file).replace(/\.tsx?$/, ".js");
    const dest = path.join(outDir, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, rewriteSpecifiers(outputText, file));
  }

  // package.json marks the emitted tree as ESM so Node parses the .js output.
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));

  const targets = selected.map((f) =>
    path.join(outDir, path.relative(srcDir, f).replace(/\.tsx?$/, ".js")),
  );
  const result = spawnSync(process.execPath, ["--test", ...targets], {
    stdio: "inherit",
    cwd: root,
  });
  process.exit(result.status ?? 1);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
