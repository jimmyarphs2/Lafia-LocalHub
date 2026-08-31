import { ESLint } from "eslint";

const patterns = [
  "app/**/*.{ts,tsx}",
  "components/**/*.{ts,tsx}",
  "lib/**/*.{ts,tsx}",
  "types/**/*.ts",
  "tests/**/*.{ts,tsx}",
  "scripts/**/*.mjs",
  "*.{ts,mts,mjs}",
];

const eslint = new ESLint({
  cache: true,
  cacheLocation: ".next/cache/eslint",
  errorOnUnmatchedPattern: false,
});

const results = await eslint.lintFiles(patterns);
const formatter = await eslint.loadFormatter("stylish");
const output = await formatter.format(results);

if (output) {
  process.stdout.write(output);
}

const errorCount = results.reduce(
  (total, result) => total + result.errorCount,
  0,
);
const warningCount = results.reduce(
  (total, result) => total + result.warningCount,
  0,
);
const exitCode = errorCount === 0 && warningCount === 0 ? 0 : 1;

// Some Windows/Node combinations retain a plugin worker handle after ESLint
// finishes. Exiting explicitly keeps CI and local quality runs deterministic.
process.exit(exitCode);
