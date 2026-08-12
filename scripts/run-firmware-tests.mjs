#!/usr/bin/env node
/**
 * Compiles and runs the host-side firmware tests.
 *
 * Only the Arduino-free parsing code in firmware/rescue_watch/at_parse.h is
 * covered — that is the layer whose bugs kept SOS events off the dashboard.
 * Radio, TLS, GPS and button electrical behaviour still require the physical
 * device; the suite makes no claim about them.
 *
 * Skips (exit 0) when no C++ compiler is available, so `npm test` still works
 * on machines without a toolchain.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "firmware", "test", "test_at_parse.cpp");

const compiler = ["g++", "clang++", "c++"].find(
  (c) => spawnSync(c, ["--version"], { stdio: "ignore" }).status === 0,
);

if (!compiler) {
  console.log("# firmware tests skipped — no C++ compiler found (install g++ or clang++)");
  process.exit(0);
}
if (!existsSync(source)) {
  console.error(`Missing firmware test source: ${source}`);
  process.exit(1);
}

const outDir = path.join(root, "node_modules", ".cache");
mkdirSync(outDir, { recursive: true });
const binary = path.join(outDir, "seaguard-firmware-tests");

try {
  const compile = spawnSync(
    compiler,
    ["-std=c++17", "-Wall", "-Wextra", "-Werror", "-O1", source, "-o", binary],
    { stdio: "inherit" },
  );
  if (compile.status !== 0) {
    console.error(`# firmware tests failed to compile with ${compiler}`);
    process.exit(compile.status ?? 1);
  }
  const run = spawnSync(binary, { stdio: "inherit" });
  process.exit(run.status ?? 1);
} finally {
  rmSync(binary, { force: true });
}
