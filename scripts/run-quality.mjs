import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

const checks = [
  ["typegen", ["node_modules/next/dist/bin/next", "typegen"]],
  ["typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["lint", ["scripts/run-eslint.mjs"]],
  ["format", ["node_modules/prettier/bin/prettier.cjs", "--check", "."]],
  ["test", ["node_modules/vitest/vitest.mjs", "run"]],
  ["build", ["node_modules/next/dist/bin/next", "build"]],
];

for (const [name, args] of checks) {
  process.stdout.write(`\n[quality] ${name}\n`);
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`[quality] ${name} could not start:`, result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[quality] ${name} failed with exit code ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}

process.stdout.write("\n[quality] all checks passed\n");
