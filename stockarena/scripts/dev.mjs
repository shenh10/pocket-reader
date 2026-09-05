import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function readDotEnv() {
  if (!existsSync(".env")) return {};
  return Object.fromEntries(
    readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
        return [key, value];
      })
  );
}

const env = {
  ...readDotEnv(),
  ...process.env
};

env.DATA_GATEWAY_PORT = env.DATA_GATEWAY_PORT ?? "8787";
env.VITE_DATA_API_BASE = env.VITE_DATA_API_BASE ?? "";

const children = [
  spawn("node", ["server/data-gateway.mjs"], { env, stdio: "inherit" }),
  spawn(process.platform === "win32" ? "node_modules/.bin/vite.cmd" : "node_modules/.bin/vite", ["--host", "127.0.0.1"], {
    env,
    stdio: "inherit"
  })
];

function shutdown(signal) {
  for (const child of children) {
    child.kill(signal);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown("SIGTERM");
      process.exit(code);
    }
  });
}
