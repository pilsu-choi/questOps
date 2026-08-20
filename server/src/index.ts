import express from "express";
import cors from "cors";
import "./db.js";
import { projectsRouter } from "./routes/projects.js";
import { documentsRouter } from "./routes/documents.js";
import { interviewRouter } from "./routes/interview.js";
import { demoRouter } from "./routes/demo.js";
import { presentationRouter } from "./routes/presentation.js";
import { settingsRouter } from "./routes/settings.js";
import { activeModelInfo, llmAvailable } from "./llm/provider.js";
import { logInfo, logError } from "./logger.js";

const app = express();
const PORT = Number(process.env.PORT) || 8787;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    logInfo(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, llmAvailable: llmAvailable(), activeModel: activeModelInfo() });
});

app.use("/api/projects", projectsRouter);
app.use("/api", documentsRouter);
app.use("/api", interviewRouter);
app.use("/api", demoRouter);
app.use("/api", presentationRouter);
app.use("/api", settingsRouter);

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logError(`${req.method} ${req.originalUrl} failed`, err);
  res.status(500).json({ error: err?.message || "서버 오류가 발생했습니다." });
});

app.listen(PORT, () => {
  logInfo(
    `QuestOps server listening on :${PORT} (LLM ${llmAvailable() ? "enabled" : "disabled — using heuristic fallback"}, LOG_LEVEL=${
      process.env.LOG_LEVEL || "debug (default)"
    })`
  );
});
