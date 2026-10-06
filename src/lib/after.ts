/**
 * Keep background work alive after the response (R2-m5). On Vercel a function may be frozen once its
 * response is sent; Next's after() keeps it running up to the route's maxDuration. Outside a request
 * scope (unit tests, scripts) after() throws, and the work then simply runs on in the background.
 */
import "server-only";
import { after } from "next/server";
import { log } from "@/lib/log";

export function runAfterResponse(task: () => Promise<unknown>): void {
  const safe = () => task().catch((err: unknown) => log("after_task_failed", { error: err instanceof Error ? err.name : "unknown" }, "error"));
  try {
    after(safe);
  } catch {
    void safe();
  }
}
