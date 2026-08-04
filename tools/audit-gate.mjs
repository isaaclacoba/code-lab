#!/usr/bin/env node
// audit-gate.mjs - mechanical auditor gate for code-lab.
//
// Purpose:
//   Fast, diff-aware pre-commit gate. Runs code-lab's deterministic checks and
//   exits 0 (pass) / 1 (fail). Wired as a committable git pre-commit hook so a
//   `git commit` inside code-lab is blocked when a check fails.
//
// Checks (only the FAST deterministic ones the repo already provides):
//   - npm run typecheck   (tsc --noEmit on src + test projects)
//   - npm run test        (node --import tsx --test test/*.test.ts)
//   The heavy `npm run build` (tsup) is intentionally NOT run here - too slow
//   for a pre-commit hook; leave it for CI / manual.
//
// Diff-aware:
//   Reads staged files (git diff --cached --name-only --diff-filter=ACM). The
//   checks run only when a code-relevant path is staged (src/, test/, or the
//   TypeScript/build config). A docs-only or asset-only commit passes fast
//   without invoking tsc / the test runner.
//
// Flags:
//   --all     Run every check regardless of what is staged (ignore diff).
//   --help    Print this usage and exit 0.
//
// Exit codes:
//   0  all applicable checks passed (or nothing code-relevant staged).
//   1  a check failed, or the gate itself could not run a check.
//   2  bad usage.
//
// Enable the hook in this clone (tracked hook, not .git/hooks):
//   git config core.hooksPath .githooks
//
// Zero new dependencies: uses only Node builtins + scripts already in package.json.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
if (argv.includes("--help")) {
  process.stdout.write(readHeader());
  process.exit(0);
}
const runAll = argv.includes("--all");
const unknown = argv.filter((a) => a !== "--all" && a !== "--help");
if (unknown.length) {
  process.stderr.write(`audit-gate: unknown argument(s): ${unknown.join(", ")}\n`);
  process.exit(2);
}

// Paths whose changes require the code checks to run.
const CODE_RELEVANT = [
  /^src\//,
  /^test\//,
  /^tsconfig(\.[\w-]+)?\.json$/,
  /^tsup\.config\.ts$/,
  /^package\.json$/,
  /^package-lock\.json$/,
];

function stagedFiles() {
  const r = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACM"],
    { cwd: repoRoot, encoding: "utf8" }
  );
  if (r.status !== 0) {
    process.stderr.write(`audit-gate: failed to read staged files\n${r.stderr || ""}`);
    process.exit(1);
  }
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

function runScript(script) {
  process.stdout.write(`audit-gate: running \`npm run ${script}\`\n`);
  const r = spawnSync("npm", ["run", "--silent", script], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (r.error) {
    process.stderr.write(`audit-gate: could not start \`npm run ${script}\`: ${r.error.message}\n`);
    return false;
  }
  return r.status === 0;
}

function readHeader() {
  // Reprint this file's leading comment block as usage text.
  return [
    "audit-gate.mjs - mechanical auditor gate for code-lab",
    "",
    "Usage: node tools/audit-gate.mjs [--all] [--help]",
    "",
    "Runs `npm run typecheck` and `npm run test` when code-relevant files are",
    "staged (src/, test/, tsconfig*, tsup.config.ts, package*.json). Exits 0 on",
    "pass, 1 on failure. --all ignores the staged-file diff and runs every check.",
    "",
    "Enable as a pre-commit hook: git config core.hooksPath .githooks",
    "",
  ].join("\n");
}

function main() {
  if (!runAll) {
    const staged = stagedFiles();
    const relevant = staged.filter((f) => CODE_RELEVANT.some((re) => re.test(f)));
    if (relevant.length === 0) {
      process.stdout.write(
        "audit-gate: no code-relevant files staged - skipping typecheck/test.\n"
      );
      process.exit(0);
    }
    process.stdout.write(
      `audit-gate: ${relevant.length} code-relevant file(s) staged.\n`
    );
  }

  const results = [
    ["typecheck", runScript("typecheck")],
    ["test", runScript("test")],
  ];

  const failed = results.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) {
    process.stderr.write(`audit-gate: FAIL (${failed.join(", ")})\n`);
    process.exit(1);
  }
  process.stdout.write("audit-gate: PASS\n");
  process.exit(0);
}

main();
