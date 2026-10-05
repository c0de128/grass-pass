import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildRequestBody,
  callModel,
  configuredModelId,
  DEFAULT_MODEL_ID,
  hasModelKey,
  MAX_MODEL_TIMEOUT_MS,
  MEASURED_SLOWEST_MS,
  MODEL_TIMEOUT_MS,
  modelEndpoint,
  ModelError,
  modelTimeoutMs,
  parseCompletion,
  resolveModelTarget,
  RETRY_BUDGET_SHARE,
  ROUTE_MAX_DURATION_SEC,
  type ModelLogLine,
  type ModelRequest,
} from "@/lib/model";
import { setLogSink } from "@/lib/log";
// Real recording (see tests/fixtures/README.md).
import recording from "../fixtures/do-gemma-4-31b-it-celebration-two-items.json";

const recorded = recording.response;
const KEY = "test-key-should-never-appear-in-logs-123";
const PROMPT_SECRET_TEXT = "Celebration Park has 2 basketball courts";

const schema = z.object({ items: z.array(z.object({ itemId: z.string(), clue: z.string() })).min(2).max(2) });
const request: ModelRequest<z.infer<typeof schema>> = {
  task: "test",
  messages: recording.request.messages as ModelRequest<unknown>["messages"],
  jsonSchema: recording.request.jsonSchema,
  schemaName: recording.request.schemaName,
  schema,
};

type Step = { status?: number; body?: unknown; throws?: unknown; hang?: boolean; headers?: Record<string, string> };

/** Injected transport: replays the recorded completion, or a transport failure. */
function transport(steps: Step[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init: init ?? {} });
    const s = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (s.hang) {
      return new Promise((_, reject) => {
        const sig = init?.signal;
        sig?.addEventListener("abort", () => reject(sig.reason), { once: true });
      });
    }
    if (s.throws) throw s.throws;
    const body = typeof s.body === "string" ? s.body : JSON.stringify(s.body ?? recorded);
    return new Response(body, { status: s.status ?? 200, headers: { "content-type": "application/json", ...s.headers } });
  };
  return { fetch, calls };
}

function withChoice(patch: Record<string, unknown>, message?: Record<string, unknown>) {
  const choice = recorded.choices[0];
  return { ...recorded, choices: [{ ...choice, ...patch, message: { ...choice.message, ...message } }] };
}

function run(steps: Step[], extra: Parameters<typeof callModel>[1] = {}) {
  const logs: ModelLogLine[] = [];
  const t = transport(steps);
  const result = callModel(request, {
    env: { DO_INFERENCE_API_KEY: KEY },
    fetch: t.fetch,
    logger: (l) => logs.push(l),
    backoffMs: 1,
    ...extra,
  });
  return { result, logs, calls: t.calls };
}

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ModelError);
    return e as ModelError;
  }
  throw new Error("expected a ModelError");
}

describe("request body", () => {
  it("uses Gemma 4 31B, strict json_schema, ADR 0001 max_tokens and temperature", () => {
    const body = buildRequestBody(request, DEFAULT_MODEL_ID);
    expect(body.model).toBe("gemma-4-31B-it");
    expect(body.max_tokens).toBe(2000);
    expect(body.temperature).toBe(0.4);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "fixture_items", strict: true, schema: request.jsonSchema },
    });
  });
});

describe("parseCompletion (real recording)", () => {
  it("parses the real Gemma completion and takes the label from the answering model", () => {
    const { data, info } = parseCompletion(recorded, schema, "requested-model");
    expect(data.items).toHaveLength(2);
    expect(info.finishReason).toBe("stop");
    expect(info.promptTokens).toBe(recorded.usage.prompt_tokens);
    expect(info.completionTokens).toBe(recorded.usage.completion_tokens);
    expect(info.answeredModel).toBe("gemma-4-31B-it");
  });

  it("falls back to the requested model id when the server omits or garbles `model`", () => {
    expect(parseCompletion({ ...recorded, model: undefined }, schema, "qwen3:4b-instruct").info.answeredModel).toBe("qwen3:4b-instruct");
    expect(parseCompletion({ ...recorded, model: "<script>" }, schema, "x-model").info.answeredModel).toBe("x-model");
  });

  it.each([
    ["finish_reason length (truncated)", withChoice({ finish_reason: "length" }), "finish_length"],
    ["empty content", withChoice({}, { content: "" }), "empty"],
    ["null content", withChoice({}, { content: null }), "empty"],
    ["content that is not JSON", withChoice({}, { content: '{"items": [' }), "not_json"],
    ["JSON of the wrong shape", withChoice({}, { content: '{"groups": []}' }), "schema"],
    ["an under-filled array", withChoice({}, { content: '{"items": []}' }), "schema"],
    ["no choices", { ...recorded, choices: [] }, "envelope"],
  ])("treats %s as bad output", (_, body, reason) => {
    expect(() => parseCompletion(body, schema, DEFAULT_MODEL_ID)).toThrowError(
      expect.objectContaining({ code: "MODEL_BAD_OUTPUT", badOutput: reason }),
    );
  });
});

describe("callModel", () => {
  it("returns validated data, the answering model as label, and logs one ok line", async () => {
    const { result, logs, calls } = run([{}]);
    const r = await result;
    expect(r.data.items.map((i) => i.itemId)).toEqual(["osm-basketball", "osm-playground"]);
    expect(r.modelLabel).toBe("gemma-4-31B-it");
    expect(r.attempts).toBe(1);
    expect(calls).toHaveLength(1);
    expect(logs).toEqual([
      expect.objectContaining({
        task: "test",
        model: DEFAULT_MODEL_ID,
        answeredModel: "gemma-4-31B-it",
        attempt: 1,
        outcome: "ok",
        upstreamStatus: 200,
        finishReason: "stop",
        promptTokens: recorded.usage.prompt_tokens,
        completionTokens: recorded.usage.completion_tokens,
        latencyMs: expect.any(Number),
      }),
    ]);
  });

  it("names the model that actually answered, not the configured one (no hard-coded label)", async () => {
    const t = transport([{ body: { ...recorded, model: "llama-4-maverick" } }]);
    const r = await callModel(request, { env: { DO_INFERENCE_API_KEY: KEY }, fetch: t.fetch, logger: () => {} });
    expect(r.modelLabel).toBe("llama-4-maverick");
  });

  it("sends the key only in the Authorization header", async () => {
    const { result, calls } = run([{}]);
    await result;
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(String(calls[0].init.body)).not.toContain(KEY);
  });

  it("fails fast with MODEL_NOT_CONFIGURED when there is no key (no call)", async () => {
    const t = transport([{}]);
    const e = await errorOf(callModel(request, { env: { DO_INFERENCE_API_KEY: " " }, fetch: t.fetch, logger: () => {} }));
    expect([e.code, e.status]).toEqual(["MODEL_NOT_CONFIGURED", 503]);
    expect(e.reason).toMatch(/no AI key/);
    expect(t.calls).toHaveLength(0);
  });

  it("retries once on a 502 and then succeeds", async () => {
    const { result, logs, calls } = run([{ status: 502, body: { error: "model_error" } }, {}]);
    expect((await result).attempts).toBe(2);
    expect(calls).toHaveLength(2);
    expect(logs.map((l) => [l.attempt, l.outcome, l.upstreamStatus])).toEqual([
      [1, "provider_error", 502],
      [2, "ok", 200],
    ]);
  });

  it("retries once on a network error and then succeeds", async () => {
    const { result, logs } = run([{ throws: new TypeError("fetch failed") }, {}]);
    expect((await result).attempts).toBe(2);
    expect(logs.map((l) => l.outcome)).toEqual(["network", "ok"]);
    expect(logs[0].errName).toBe("TypeError");
  });

  it("gives MODEL_PROVIDER after two 5xx answers (only one retry)", async () => {
    const { result, calls } = run([{ status: 503 }, { status: 500 }, {}]);
    const e = await errorOf(result);
    expect([e.code, e.status, e.upstreamStatus]).toEqual(["MODEL_PROVIDER", 502, 500]);
    expect(calls).toHaveLength(2);
  });

  it("gives MODEL_NETWORK after two network errors", async () => {
    const { result, calls } = run([{ throws: new TypeError("fetch failed") }]);
    expect((await errorOf(result)).code).toBe("MODEL_NETWORK");
    expect(calls).toHaveLength(2);
  });

  it("does not retry a 4xx", async () => {
    const { result, calls } = run([{ status: 401 }]);
    const e = await errorOf(result);
    expect([e.code, e.upstreamStatus]).toEqual(["MODEL_PROVIDER", 401]);
    expect(calls).toHaveLength(1);
  });

  it("maps 429 to MODEL_RATE_LIMITED with Retry-After and no retry", async () => {
    const { result, calls, logs } = run([{ status: 429, headers: { "retry-after": "20" } }]);
    const e = await errorOf(result);
    expect([e.code, e.retryAfter, e.status]).toEqual(["MODEL_RATE_LIMITED", 20, 503]);
    expect(calls).toHaveLength(1);
    expect(logs[0].outcome).toBe("rate_limited");
  });

  it("maps 402 (no balance) to MODEL_QUOTA with no retry", async () => {
    const { result, calls, logs } = run([{ status: 402 }]);
    const e = await errorOf(result);
    expect([e.code, e.status]).toEqual(["MODEL_QUOTA", 503]);
    expect(e.reason).toMatch(/budget/);
    expect(calls).toHaveLength(1);
    expect(logs[0].outcome).toBe("quota");
  });

  it("does not retry when too little of the budget is left", async () => {
    const { result, calls } = run([{ status: 502 }, {}], { minRetryBudgetMs: 10 * 60_000 });
    expect((await errorOf(result)).code).toBe("MODEL_PROVIDER");
    expect(calls).toHaveLength(1);
  });

  it("maps the deadline to MODEL_TIMEOUT (no retry) and says how long it waited", async () => {
    const { result, calls, logs } = run([{ hang: true }], { timeoutMs: 30 });
    const e = await errorOf(result);
    expect([e.code, e.status]).toEqual(["MODEL_TIMEOUT", 504]);
    expect(calls).toHaveLength(1);
    expect(logs[0].outcome).toBe("timeout");
  });

  it("maps a caller abort to ABORTED", async () => {
    const ctrl = new AbortController();
    const { result, logs } = run([{ hang: true }], { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 5);
    const e = await errorOf(result);
    expect([e.code, e.status]).toEqual(["ABORTED", 499]);
    expect(logs[0].outcome).toBe("aborted");
  });

  it("treats a truncated answer as bad output, logged with finish_reason and no retry", async () => {
    const { result, logs, calls } = run([{ body: withChoice({ finish_reason: "length" }) }]);
    expect((await errorOf(result)).code).toBe("MODEL_BAD_OUTPUT");
    expect(logs[0]).toMatchObject({ outcome: "bad_output", finishReason: "length", badOutput: "finish_length" });
    expect(calls).toHaveLength(1);
  });

  it("treats a non-JSON HTTP body as bad output", async () => {
    const { result, logs } = run([{ body: "<html>gateway</html>" }]);
    expect((await errorOf(result)).code).toBe("MODEL_BAD_OUTPUT");
    expect(logs[0].outcome).toBe("bad_output");
  });

  it("the default logger writes one JSON line per attempt with no key and no prompt text", async () => {
    const lines: string[] = [];
    const restore = setLogSink((_, line) => lines.push(line));
    try {
      for (const steps of [[{}], [{ status: 502 }, {}], [{ status: 401 }], [{ body: withChoice({ finish_reason: "length" }) }]] as Step[][]) {
        const t = transport(steps);
        await callModel(request, { env: { DO_INFERENCE_API_KEY: KEY }, fetch: t.fetch, backoffMs: 1 }).catch(() => undefined);
      }
    } finally {
      restore();
    }
    expect(lines).toHaveLength(5);
    for (const l of lines) expect(JSON.parse(l)).toMatchObject({ event: "model_call", model: DEFAULT_MODEL_ID, latencyMs: expect.any(Number) });
    // Token counts survive the log redaction (only credential-like field names are hidden).
    expect(JSON.parse(lines[0])).toMatchObject({ outcome: "ok", promptTokens: recorded.usage.prompt_tokens });
    const text = lines.join("\n");
    expect(text).not.toContain(KEY);
    expect(text).not.toMatch(/bearer/i);
    expect(text).not.toContain(PROMPT_SECRET_TEXT);
    expect(text).not.toContain("Dribble"); // model output text is never logged either
  });
});

describe("timing budget (ADR 0001, SPEC §5.2)", () => {
  it("timeout is at least 2x the slowest measured Gemma answer", () => {
    expect(MODEL_TIMEOUT_MS).toBeGreaterThanOrEqual(MEASURED_SLOWEST_MS * 2);
  });

  it("route maxDuration leaves >= 20 s over the longest allowed timeout", () => {
    expect(ROUTE_MAX_DURATION_SEC * 1000 - MAX_MODEL_TIMEOUT_MS).toBeGreaterThanOrEqual(20_000);
  });

  it("a retry only starts when a normal answer still fits", () => {
    expect(MODEL_TIMEOUT_MS * RETRY_BUDGET_SHARE).toBeGreaterThan(MEASURED_SLOWEST_MS);
  });

  it("MODEL_TIMEOUT_MS env is clamped to 5-70 s", () => {
    expect(modelTimeoutMs({})).toBe(30_000);
    expect(modelTimeoutMs({ MODEL_TIMEOUT_MS: "60000" })).toBe(60_000);
    expect(modelTimeoutMs({ MODEL_TIMEOUT_MS: "999999" })).toBe(70_000);
    expect(modelTimeoutMs({ MODEL_TIMEOUT_MS: "10" })).toBe(5_000);
    expect(modelTimeoutMs({ MODEL_TIMEOUT_MS: "soon" })).toBe(30_000);
  });
});

describe("modelEndpoint (swap the server, same open weights)", () => {
  it("defaults to DigitalOcean and gemma-4-31B-it", () => {
    expect(modelEndpoint({})).toEqual({ baseUrl: "https://inference.do-ai.run/v1", model: "gemma-4-31B-it" });
    expect(configuredModelId({})).toBe("gemma-4-31B-it");
  });

  it("accepts an OpenAI-compatible local server such as Ollama", () => {
    expect(modelEndpoint({ MODEL_BASE_URL: "http://localhost:11434/v1/", MODEL_ID: "gemma4:e2b" })).toEqual({
      baseUrl: "http://localhost:11434/v1",
      model: "gemma4:e2b",
    });
  });

  it("falls back to the defaults on invalid values", () => {
    expect(modelEndpoint({ MODEL_BASE_URL: "file:///etc/passwd", MODEL_ID: "bad id; rm" })).toEqual({
      baseUrl: "https://inference.do-ai.run/v1",
      model: DEFAULT_MODEL_ID,
    });
    expect(modelEndpoint({ MODEL_BASE_URL: "not a url" }).baseUrl).toBe("https://inference.do-ai.run/v1");
  });
});

// SEC-F-01 (factory hardening audit, 2026-10-02): the DigitalOcean key is a full account token.
// It must only ever reach https://inference.do-ai.run; every other host uses MODEL_API_KEY.
describe("which key goes to which host (SEC-F-01)", () => {
  const DO_KEY = "dop_v1_REAL_DO_KEY_MUST_NOT_LEAVE_DO";

  async function sentTo(env: Record<string, string | undefined>) {
    const t = transport([{}]);
    try {
      await callModel(request, { env, fetch: t.fetch, logger: () => {}, backoffMs: 1 });
    } catch (e) {
      expect(e).toBeInstanceOf(ModelError);
    }
    return { urls: t.calls.map((c) => c.url), auth: t.calls.map((c) => new Headers(c.init.headers).get("authorization")) };
  }

  it("sends DO_INFERENCE_API_KEY to DigitalOcean (default and explicit)", async () => {
    for (const base of [undefined, "https://inference.do-ai.run/v1"]) {
      const r = await sentTo({ DO_INFERENCE_API_KEY: DO_KEY, MODEL_BASE_URL: base });
      expect(r.urls[0]).toBe("https://inference.do-ai.run/v1/chat/completions");
      expect(r.auth[0]).toBe(`Bearer ${DO_KEY}`);
    }
  });

  it("never sends the DO key to another https host; uses MODEL_API_KEY there", async () => {
    const r = await sentTo({ DO_INFERENCE_API_KEY: DO_KEY, MODEL_API_KEY: "other-provider-key", MODEL_BASE_URL: "https://api.example.test/v1" });
    expect(r.urls[0]).toBe("https://api.example.test/v1/chat/completions");
    expect(r.auth[0]).toBe("Bearer other-provider-key");
    expect(JSON.stringify(r)).not.toContain(DO_KEY);
  });

  it("refuses a hosted provider without MODEL_API_KEY instead of falling back to the DO key", async () => {
    const env = { DO_INFERENCE_API_KEY: DO_KEY, MODEL_BASE_URL: "https://api.example.test/v1" };
    const r = await sentTo(env);
    expect(r.urls).toHaveLength(0);
    expect(resolveModelTarget(env)).toEqual({ ok: false, reason: "MODEL_API_KEY is required for a hosted MODEL_BASE_URL" });
    expect(hasModelKey(env)).toBe(false);
  });

  it("look-alike hosts and other ports never get the DO key", async () => {
    for (const base of [
      "https://inference.do-ai.run.evil.test/v1",
      "https://evil.test/inference.do-ai.run/v1",
      "https://inference.do-ai.run:8443/v1",
      "https://xinference.do-ai.run/v1",
    ]) {
      const r = await sentTo({ DO_INFERENCE_API_KEY: DO_KEY, MODEL_BASE_URL: base });
      expect(JSON.stringify(r)).not.toContain(DO_KEY);
    }
  });

  it("refuses plain http except localhost / 127.0.0.1 (no call, no key)", async () => {
    for (const base of ["http://example.test/v1", "http://10.0.0.5:11434/v1", "http://inference.do-ai.run/v1"]) {
      const r = await sentTo({ DO_INFERENCE_API_KEY: DO_KEY, MODEL_API_KEY: "k2", MODEL_BASE_URL: base });
      expect(r.urls).toHaveLength(0);
      expect(modelEndpoint({ MODEL_BASE_URL: base }).error).toMatch(/must use https/);
    }
  });

  it("refuses a base URL with user:pass@", () => {
    expect(resolveModelTarget({ MODEL_API_KEY: "k", MODEL_BASE_URL: "https://u:p@api.example.test/v1" })).toMatchObject({ ok: false });
  });

  it("localhost Ollama works with no key (no Authorization header) and never gets the DO key", async () => {
    for (const base of ["http://localhost:11434/v1", "http://127.0.0.1:11434/v1"]) {
      const r = await sentTo({ DO_INFERENCE_API_KEY: DO_KEY, MODEL_BASE_URL: base });
      expect(r.urls[0]).toBe(`${base}/chat/completions`);
      expect(r.auth[0]).toBeNull();
    }
    const withKey = await sentTo({ DO_INFERENCE_API_KEY: DO_KEY, MODEL_API_KEY: "unused", MODEL_BASE_URL: "http://localhost:11434/v1" });
    expect(withKey.auth[0]).toBe("Bearer unused");
    expect(hasModelKey({ MODEL_BASE_URL: "http://localhost:11434/v1" })).toBe(true);
  });

  it("no DO key on the DO host = not configured", () => {
    expect(hasModelKey({})).toBe(false);
    expect(hasModelKey({ DO_INFERENCE_API_KEY: "  " })).toBe(false);
  });
});

describe("no redirects on model calls (SEC-R2-01)", () => {
  it("asks fetch never to follow redirects", async () => {
    const { result, calls } = run([{}]);
    await result;
    expect(calls[0].init.redirect).toBe("error");
  });

  it("a real 307 from the model host is not followed: the prompt never reaches the other origin", async () => {
    const hits: string[] = [];
    const other = createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(recorded));
    });
    await new Promise<void>((ok) => other.listen(0, "127.0.0.1", ok));
    const otherPort = (other.address() as { port: number }).port;
    const model = createServer((req, res) => {
      req.resume();
      res.writeHead(307, { location: `http://localhost:${otherPort}/hop` });
      res.end();
    });
    await new Promise<void>((ok) => model.listen(0, "127.0.0.1", ok));
    const modelPort = (model.address() as { port: number }).port;
    try {
      const e = await errorOf(
        callModel(request, { env: { MODEL_BASE_URL: `http://127.0.0.1:${modelPort}/v1` }, logger: () => {}, backoffMs: 1 }),
      );
      expect(e.code).toBe("MODEL_NETWORK");
      expect(hits).toEqual([]);
    } finally {
      await new Promise((ok) => model.close(ok));
      await new Promise((ok) => other.close(ok));
    }
  });
});
