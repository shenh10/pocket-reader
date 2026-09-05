import { Router } from "express";
import { APP_TIMEZONE, CATEGORY_LABELS, IMPORTANCE_LABELS } from "./config";
import {
  getAnnualHighlights,
  getDashboard,
  getTimeline,
  listRepositories,
  listSnapshots,
  updatePullRequestState
} from "./db";
import { normalizeDateInput, recentHalfYearRange, todayISODate } from "./date";
import { runDailyDigest, runRangeDigest } from "./digest";
import { sendDesktopNotification } from "./notifications";

export function createApiRouter(): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true, timezone: APP_TIMEZONE });
  });

  router.get("/config", async (_req, res, next) => {
    try {
      res.json({
        timezone: APP_TIMEZONE,
        categories: CATEGORY_LABELS,
        importanceLabels: IMPORTANCE_LABELS,
        repositories: await listRepositories(false)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/days", async (_req, res, next) => {
    try {
      res.json(await listSnapshots());
    } catch (error) {
      next(error);
    }
  });

  router.get("/dashboard", async (req, res, next) => {
    try {
      const date = normalizeDateInput(String(req.query.date ?? "today"));
      res.json(await getDashboard(date));
    } catch (error) {
      next(error);
    }
  });

  router.get("/timeline", async (req, res, next) => {
    try {
      const range = recentHalfYearRange();
      const start = normalizeDateInput(String(req.query.start ?? range.start));
      const end = normalizeDateInput(String(req.query.end ?? range.end));
      const limit = Math.max(1, Math.min(10000, Number(req.query.limit ?? 2000)));
      res.json(await getTimeline(start, end, limit));
    } catch (error) {
      next(error);
    }
  });

  router.get("/highlights", async (req, res, next) => {
    try {
      const year = Number(req.query.year ?? todayISODate().slice(0, 4));
      const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 60)));
      res.json(await getAnnualHighlights(year, limit));
    } catch (error) {
      next(error);
    }
  });

  router.post("/fetch", async (req, res, next) => {
    try {
      const date = normalizeDateInput(req.body?.date);
      const result = await runDailyDigest({
        date,
        notify: Boolean(req.body?.notify)
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/fetch-range", async (req, res, next) => {
    try {
      const range = recentHalfYearRange();
      const result = await runRangeDigest({
        start: req.body?.start ?? range.start,
        end: req.body?.end ?? range.end,
        notify: Boolean(req.body?.notify)
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/prs/:id/state", async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid PR id" });
        return;
      }
      const updated = await updatePullRequestState(id, {
        isFavorite: req.body?.isFavorite,
        isRead: req.body?.isRead,
        watchLater: req.body?.watchLater,
        userNote: req.body?.userNote
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.post("/notify/test", (_req, res) => {
    sendDesktopNotification({
      title: "AI Infra Merge Board",
      message: "Local desktop notifications are wired up.",
      open: process.env.APP_URL ?? "http://localhost:5173"
    });
    res.json({ ok: true });
  });

  return router;
}
