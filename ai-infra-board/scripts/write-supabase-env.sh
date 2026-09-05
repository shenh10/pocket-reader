#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POOLER_FILE="$PROJECT_DIR/supabase/.temp/pooler-url"

if [[ ! -f "$POOLER_FILE" ]]; then
  echo "Missing $POOLER_FILE. Run supabase link --project-ref rihzdwrefdjruzgdtasb first." >&2
  exit 1
fi

printf "Supabase database password: " >&2
IFS= read -rs SUPABASE_DB_PASSWORD
printf "\n" >&2

if [[ -z "$SUPABASE_DB_PASSWORD" ]]; then
  echo "Password cannot be empty." >&2
  exit 1
fi

export PROJECT_DIR
export POOLER_URL="$(cat "$POOLER_FILE")"
export SUPABASE_DB_PASSWORD

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const projectDir = process.env.PROJECT_DIR;
const poolerUrl = process.env.POOLER_URL;
const password = process.env.SUPABASE_DB_PASSWORD;

if (!projectDir || !poolerUrl || !password) {
  throw new Error("Missing PROJECT_DIR, POOLER_URL, or SUPABASE_DB_PASSWORD.");
}

const url = new URL(poolerUrl);
url.password = password;
url.searchParams.set("sslmode", "no-verify");

const envPath = path.join(projectDir, ".env");
const examplePath = path.join(projectDir, ".env.example");
let content = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, "utf8")
  : fs.readFileSync(examplePath, "utf8");

function setEnv(key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) {
    content = content.replace(pattern, line);
  } else {
    content = `${content.replace(/\s*$/, "")}\n${line}\n`;
  }
}

setEnv("DATABASE_URL", url.toString());
setEnv("DATABASE_SSL", "true");
setEnv("DATABASE_POOL_MAX", "8");
setEnv("DATABASE_CONNECT_TIMEOUT_MS", "10000");

fs.writeFileSync(envPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
console.log(`Wrote ${envPath}`);
console.log(`Host: ${url.hostname}`);
NODE
