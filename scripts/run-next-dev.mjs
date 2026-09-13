import { spawn } from "node:child_process";

const forwarded = [];
for (const argument of process.argv.slice(2)) {
  if (argument === "--host") {
    forwarded.push("--hostname");
    continue;
  }
  if (argument === "--strictPort") continue;
  forwarded.push(argument);
}

const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", ...forwarded],
  {
    env: process.env,
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
