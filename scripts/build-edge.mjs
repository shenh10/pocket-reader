import { build } from "esbuild";
await build({
  entryPoints: ["ai-infra-board/src/server/edge-entry.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  outfile: "ai-infra-board/supabase/functions/pocket-reader/index.ts",
  banner: {
    js: 'const POCKET_DB = Deno.env.get("POCKET_DATABASE_URL"); if (!POCKET_DB) throw new Error("Missing database configuration");',
  },
  define: {
    "process.env.DATABASE_URL": "POCKET_DB",
    "process.env.DATABASE_SSL": '"true"',
    "process.env.DATABASE_POOL_MAX": '"2"',
    "process.env.DATABASE_CONNECT_TIMEOUT_MS": '"8000"',
    "process.env.TIMEZONE": '"Asia/Shanghai"',
  },
  plugins: [
    {
      name: "edge-dependencies",
      setup(b) {
        b.onResolve({ filter: /^pg$/ }, () => ({
          path: "npm:pg@8.13.1",
          external: true,
        }));
        b.onResolve({ filter: /^dotenv\/config$/ }, () => ({
          path: "dotenv",
          namespace: "empty",
        }));
        b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({
          contents: "",
          loader: "js",
        }));
      },
    },
  ],
});
