import { execFile } from "node:child_process";
import { platform } from "node:os";
import { PullRequestRecord } from "../shared/types";

export function desktopNotificationsEnabled(): boolean {
  return process.env.ENABLE_DESKTOP_NOTIFICATIONS !== "false";
}

export function sendDesktopNotification(options: {
  title: string;
  message: string;
  open?: string;
}): void {
  if (!desktopNotificationsEnabled()) {
    return;
  }
  if (platform() !== "darwin") {
    console.log(`[notify] ${options.title}: ${options.message} ${options.open ?? ""}`);
    return;
  }
  const title = options.title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const message = options.message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  execFile(
    "osascript",
    ["-e", `display notification "${message}" with title "${title}"`],
    (error) => {
      if (error) {
        console.warn("[notify] desktop notification failed:", error.message);
      }
    }
  );
}

export function notifyDigestReady(date: string, prCount: number, topPullRequests: PullRequestRecord[]): void {
  const top = topPullRequests
    .slice(0, 2)
    .map((pr) => `${pr.repoDisplayName}#${pr.number}`)
    .join(", ");
  sendDesktopNotification({
    title: "AI Infra PR Digest ready",
    message: `${date}: ${prCount} merged PRs${top ? ` · Top: ${top}` : ""}`,
    open: `${process.env.APP_URL ?? "http://localhost:5173"}?date=${date}`
  });
}
