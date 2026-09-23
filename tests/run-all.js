// Runs every test file in this directory as its own child process, so a
// failing assertion in one suite can never prevent the rest from running.
// Previously package.json's "test" script chained files with `&&`, which
// meant a single early failure silently skipped every suite after it while
// still reporting a single red exit code, hiding unrelated breakages.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(testsDir)
  .filter((name) => name.endsWith(".test.js"))
  .sort();

const results = [];
for (const file of files) {
  const fullPath = path.join(testsDir, file);
  process.stdout.write(`\n=== ${file} ===\n`);
  const run = spawnSync(process.execPath, [fullPath], { stdio: "inherit" });
  results.push({ file, passed: run.status === 0 });
}

const failed = results.filter((r) => !r.passed);
process.stdout.write("\n=== Summary ===\n");
for (const result of results) {
  process.stdout.write(`${result.passed ? "PASS" : "FAIL"}  ${result.file}\n`);
}

if (failed.length > 0) {
  process.stdout.write(`\n${failed.length}/${results.length} suite(s) failed.\n`);
  process.exit(1);
}
process.stdout.write(`\nAll ${results.length} suite(s) passed.\n`);
