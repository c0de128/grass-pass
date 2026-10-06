/**
 * Self-host switch (judge G1, 2026-10-06): MODEL_REASONING_EFFORT in the model client, the self-hosted eval lane
 * (gemma4-e2b-8k on a local Ollama) and the eval-only patient clock. The default (DigitalOcean) request body and the
 * default eval model list must not change. The local "server" here is a test transport on 127.0.0.1, never Ollama.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildRequestBody, callModel, reasoningEffort, type ModelRequest } from "@/lib/model";
import { caseDataOrNull, loadCases, loadFixture } from "../../evals/fixture";
import {
  DEFAULT_MODELS,
  LOCAL_BASE_URL,
  MODEL_SPECS,
  modelEnv,
  PATIENT_CLOCK,
  resultPaths,
  runModelCase,
  settingsFromEnv,
  SpendMeter,
  type EvalResults,
} from "../../evals/run";

const schema = z.object({ ok: z.boolean() });
const request: ModelRequest<z.infer<typeof schema>> = {
  task: "test",
  messages: [{ role: "user", content: "hi" }],
  jsonSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
  schemaName: "t",
  schema,
};

function capture() {
  const bodies: Record<string, unknown>[] = [];
  const fetch = async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ model: "m", choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] }), { status: 200 });
  };
  return { fetch, bodies };
}

describe("MODEL_REASONING_EFFORT", () => {
  it("is off unless set to a known value", () => {
    expect(reasoningEffort({})).toBeNull();
    expect(reasoningEffort({ MODEL_REASONING_EFFORT: "" })).toBeNull();
    expect(reasoningEffort({ MODEL_REASONING_EFFORT: "turbo" })).toBeNull();
    expect(reasoningEffort({ MODEL_REASONING_EFFORT: " None " })).toBe("none");
    expect(reasoningEffort({ MODEL_REASONING_EFFORT: "high" })).toBe("high");
  });

  it("leaves the default request body unchanged (no reasoning_effort key)", () => {
    expect(buildRequestBody(request, "gemma-4-31B-it")).not.toHaveProperty("reasoning_effort");
    expect(buildRequestBody(request, "gemma-4-31B-it", { reasoningEffort: null })).not.toHaveProperty("reasoning_effort");
    expect(buildRequestBody(request, "gemma4-e2b-8k", { reasoningEffort: "none" })).toMatchObject({ reasoning_effort: "none" });
  });

  it("is sent by callModel only when the env sets it", async () => {
    const hosted = capture();
    await callModel(request, { env: { DO_INFERENCE_API_KEY: "k" }, fetch: hosted.fetch, logger: () => {} });
    expect(hosted.bodies[0]).not.toHaveProperty("reasoning_effort");
    const local = capture();
    await callModel(request, {
      env: { MODEL_BASE_URL: "http://localhost:11434/v1", MODEL_ID: "gemma4-e2b-8k", MODEL_REASONING_EFFORT: "none" },
      fetch: local.fetch,
      logger: () => {},
    });
    expect(local.bodies[0]).toMatchObject({ model: "gemma4-e2b-8k", reasoning_effort: "none" });
  });
});

describe("self-hosted eval lane", () => {
  it("is never in the default model list and is opt-in by EVAL_MODELS", () => {
    expect(DEFAULT_MODELS).toEqual(["gemma-4-31B-it", "llama-4-maverick"]);
    expect(settingsFromEnv({}).models.some((m) => m.local)).toBe(false);
    const s = settingsFromEnv({ EVAL_MODELS: "gemma4-e2b-8k", EVAL_LOCAL_PATIENT: "1" });
    expect(s.models.map((m) => m.id)).toEqual(["gemma4-e2b-8k"]);
    expect(s.localPatient).toBe(true);
    expect(settingsFromEnv({ EVAL_MODELS: "gemma4-e2b-8k" }).localPatient).toBe(false);
  });

  it("runs with the app's own self-host settings and never gets the DigitalOcean key", () => {
    const spec = MODEL_SPECS["gemma4-e2b-8k"];
    const env = modelEnv(spec, { DO_INFERENCE_API_KEY: "do-secret" });
    expect(env).not.toHaveProperty("DO_INFERENCE_API_KEY");
    expect(env).toMatchObject({ MODEL_BASE_URL: LOCAL_BASE_URL, MODEL_ID: "gemma4-e2b-8k", MODEL_REASONING_EFFORT: "none", MODEL_TIMEOUT_MS: "70000" });
    expect(modelEnv(spec, { EVAL_LOCAL_BASE_URL: "http://127.0.0.1:9999/v1" }).MODEL_BASE_URL).toBe("http://127.0.0.1:9999/v1");
    // Hosted lanes are unchanged.
    expect(modelEnv(MODEL_SPECS["gemma-4-31B-it"], { DO_INFERENCE_API_KEY: "do-secret" })).toMatchObject({ DO_INFERENCE_API_KEY: "do-secret", MODEL_ID: "gemma-4-31B-it" });
  });

  it("names self-host results files apart from hosted partial runs", () => {
    const meta = (notes: string[]) =>
      ({ meta: { startedAt: "2026-10-06T22:00:00.000Z", day: "2026-10-06", partial: true, modelSpecs: [MODEL_SPECS["gemma4-e2b-8k"]], notes } }) as unknown as EvalResults;
    const dir = "Z:/does-not-exist";
    expect(resultPaths(meta([]), dir).json).toMatch(/2026-10-06-selfhost-1700\.json$/);
    expect(resultPaths(meta(["PATIENT CLOCK ..."]), dir).json).toMatch(/2026-10-06-selfhost-patient-1700\.json$/);
  });

  it("keeps each patient-clock call under the 5-minute stop line", () => {
    expect(PATIENT_CLOCK.modelTimeoutMs).toBeLessThan(300_000);
    expect(PATIENT_CLOCK.refillTimeoutMs).toBeLessThanOrEqual(PATIENT_CLOCK.modelTimeoutMs);
  });
});

describe("eval-only clock reaches the pass builder", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    // Answers after 2 s: slower than the injected 300 ms clock, far faster than the app's 70 s limit.
    server = createServer((req, res) => {
      req.resume();
      setTimeout(() => {
        res.writeHead(500);
        res.end("{}");
      }, 2_000).unref();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("stops the model call at the injected limit, not the app's 70 s", async () => {
    const cases = loadCases();
    const c = cases.cases.find((x) => x.slug === "celebration-park");
    if (!c) throw new Error("celebration-park case missing");
    const fx = loadFixture(c.slug);
    const { data } = await caseDataOrNull(fx, cases.ageBand);
    if (!data) throw new Error("no case data");
    const t0 = Date.now();
    const r = await runModelCase(c, fx, data, MODEL_SPECS["gemma4-e2b-8k"], 1, cases.ageBand, { EVAL_LOCAL_BASE_URL: base }, new SpendMeter(1), {
      passDeadlineMs: 20_000,
      modelTimeoutMs: 300,
      refillTimeoutMs: 300,
    });
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(r.kind).toBe("error");
    expect(r.errorCode).toBe("MODEL_TIMEOUT");
    expect(r.calls[0]?.error).toBe("TimeoutError");
  }, 20_000);
});
