import { expect, test, type APIResponse, type Locator } from "@playwright/test";

/**
 * Live-data e2e decide on the server's error CODE, never on copy (R1-B2). These codes mean "an outside
 * service or a limit stopped this, and the page said so honestly": the test checks that the message is
 * real text and is reported as SKIPPED with the code and message. Any other code fails the test.
 */
export const HONEST_SKIP_CODES = new Set([
  // No model key (keyless CI) or the model service had a problem.
  "MODEL_NOT_CONFIGURED",
  "MODEL_NETWORK",
  "MODEL_PROVIDER",
  "MODEL_RATE_LIMITED",
  "MODEL_QUOTA",
  "MODEL_TIMEOUT",
  "MODEL_BAD_OUTPUT",
  // Free public data services were busy or slow.
  "OSM_UNAVAILABLE",
  "GEOCODER_UNAVAILABLE",
  "DATA_TOO_SLOW",
  // Our own limits (tests share one IP) and the shared store.
  "RATE_LIMITED",
  "IP_DAILY_LIMIT",
  "DAILY_LIMIT",
  "STORE_UNAVAILABLE",
  // The page stopped waiting after 45 s and said so.
  "CLIENT_TIMEOUT",
  // The park had no usable data today and the answer said so (type "empty").
  "EMPTY",
]);

/** The exact SPEC 5.4 copy for a busy OpenStreetMap (checked whenever that code is shown). */
export const OSM_BUSY = "No data available: the OpenStreetMap server is busy. Try again in a minute, or pick an example park.";

/** Skip (with the reason) for an honest outside failure; fail for anything else. */
export function skipIfHonest(code: string, message: string, where: string): void {
  expect(message.trim().length, `${where}: the page must say what went wrong`).toBeGreaterThan(10);
  if (code === "OSM_UNAVAILABLE") expect(message.trim()).toBe(OSM_BUSY);
  expect(HONEST_SKIP_CODES.has(code), `${where}: unexpected error code ${code}: ${message}`).toBe(true);
  test.skip(true, `${where}: ${code}: ${message.trim()}`);
}

/** A page alert carrying `data-error-code` (FindAPark, PassMaker). */
export async function skipIfHonestAlert(alert: Locator, where: string): Promise<void> {
  const code = (await alert.getAttribute("data-error-code")) ?? "NO_CODE";
  skipIfHonest(code, (await alert.textContent()) ?? "", where);
}

type PassLine = {
  type: string;
  message?: string;
  pass?: { id: string; items: unknown[]; spot?: unknown };
  error?: { code: string; message: string };
};

/**
 * POST /api/pass the way the page does (same origin, JSON), read to the end. Returns the pass, or
 * skips the test (honest code) / fails it (anything else).
 */
export async function passOrSkip(res: APIResponse, where: string): Promise<NonNullable<PassLine["pass"]>> {
  const body = await res.text();
  const lines = body.trim().split("\n").filter(Boolean);
  let last: PassLine & { error?: { code: string; message: string } };
  try {
    last = JSON.parse(lines[lines.length - 1] ?? "{}") as PassLine;
  } catch {
    throw new Error(`${where}: unreadable answer (${res.status()}): ${body.slice(0, 200)}`);
  }
  if (last.type === "result" && last.pass) return last.pass;
  if (last.type === "empty") skipIfHonest("EMPTY", last.message ?? "", where);
  const code = last.error?.code ?? "NO_CODE";
  skipIfHonest(code, last.error?.message ?? body.slice(0, 200), where);
  throw new Error("unreachable");
}
