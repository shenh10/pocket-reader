import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import { bootstrapDatabase } from "./digest";
import { createApiRouter } from "./routes";
import { startScheduler } from "./scheduler";

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(express.json({ limit: "2mb" }));
app.use("/api", createApiRouter());

if (process.env.NODE_ENV === "production") {
  const distPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: error.message });
});

await bootstrapDatabase();
app.listen(port, () => {
  console.log(`[api] http://localhost:${port}`);
});
startScheduler();
