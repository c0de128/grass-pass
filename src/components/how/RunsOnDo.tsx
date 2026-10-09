import { ArrowLeftRight, Cloud, Gauge, KeyRound, Wallet, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { usd, secs } from "@/lib/about/content";
import { EVAL_THRESHOLDS, evalColumn } from "@/lib/about/eval-summary";
import { limitsConfig } from "@/lib/limits/config";
import { DO_BASE_URL, DO_HOST, modelEndpoint } from "@/lib/model";

/**
 * "Runs on DigitalOcean" on /how-it-works (Kevin, 2026-10-09: "Let's add our use of DigitalOcean."). Exactly how the app
 * uses DigitalOcean, and nothing more. Every fact is read from code or the committed eval, never typed in:
 * - Endpoint: src/lib/model.ts DO_BASE_URL = https://inference.do-ai.run/v1, POST `${baseUrl}/chat/completions`
 *   (OpenAI-compatible, plain fetch). Default model DEFAULT_MODEL_ID = gemma-4-31B-it.
 * - Key-to-host rule (SEC-F-01): src/lib/model.ts resolveModelTarget sends DO_INFERENCE_API_KEY only to that host.
 * - Billing: per token on prepaid DigitalOcean credit (README "Cost", src/lib/limits/config.ts aiDailyCap comment);
 *   the daily model-call cap is limitsConfig().aiDailyCap (AI_DAILY_CAP, default 400).
 * - Speed and cost: eval run 2026-10-06-9 (src/lib/about/eval-summary.ts, re-checked against the JSON by about.test).
 *   Cost counts the clue calls only (measured before trip tips existed); the tips add one short call (RULES-10-02).
 * - Swap: MODEL_BASE_URL / MODEL_ID (src/lib/model.ts modelEndpoint). Llama 4 Maverick ran the same app code and checks
 *   on DigitalOcean in the same eval (evalColumn("llama-4-maverick"), 20 runs).
 * - Honest scope: the website is hosted on Vercel (vercel.json), not on DigitalOcean.
 * A server pointed elsewhere by MODEL_BASE_URL says where its model runs instead (no DigitalOcean claim).
 */

function Fact({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 rounded-2xl bg-muted/70 p-4 ring-1 ring-border">
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-do text-do-foreground shadow-sm">
        <Icon className="size-[1.1rem]" strokeWidth={2.25} />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <h4 className="font-heading leading-tight font-extrabold text-ink">{title}</h4>
        <p className="text-sm leading-snug">{children}</p>
      </div>
    </li>
  );
}

export function RunsOnDo() {
  const ep = modelEndpoint();
  const onDo = ep.baseUrl === DO_BASE_URL;
  const g = evalColumn("gemma-4-31B-it");
  const llama = evalColumn("llama-4-maverick");
  const cap = limitsConfig().aiDailyCap;
  const costMet = g.costPerPass <= EVAL_THRESHOLDS.costPerPass;

  return (
    <div
      id="digitalocean"
      data-testid="runs-on-do"
      className="relative grid scroll-mt-4 gap-6 overflow-hidden rounded-3xl bg-card p-6 pl-7 text-card-foreground shadow-lg ring-1 shadow-shadow/40 ring-border sm:scroll-mt-3 sm:p-8 sm:pl-9 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,2fr)] xl:gap-10"
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5 bg-do" />
      <div className="flex flex-col gap-3">
        <p className="flex w-fit items-center gap-1.5 rounded-full bg-do px-2.5 py-0.5 text-[0.7rem] font-bold tracking-wider text-do-foreground uppercase">
          <Cloud aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
          {onDo ? "Runs on DigitalOcean" : "Where the model runs"}
        </p>
        <h3 className="text-3xl leading-tight font-extrabold text-balance text-ink">
          {onDo ? "Every Gemma call runs on DigitalOcean" : `This server's model runs at ${new URL(ep.baseUrl).host}`}
        </h3>
        <p className="text-pretty">
          {onDo ? (
            <>
              Serverless inference: no GPU of our own. The website itself is hosted on Vercel.
            </>
          ) : (
            <>
              Set by <code>MODEL_BASE_URL</code> on this server. By default, Grass Pass uses DigitalOcean serverless inference.
            </>
          )}
        </p>
        <p className="mt-1 flex w-fit max-w-full flex-col gap-0.5 rounded-xl bg-band px-3 py-2 font-mono text-[0.8rem] leading-snug text-band-foreground [overflow-wrap:anywhere]">
          <span className="font-sans text-[0.65rem] font-bold tracking-wider text-band-muted uppercase">OpenAI-compatible endpoint</span>
          <span>{ep.baseUrl}</span>
        </p>
      </div>

      {onDo ? (
        <ul aria-label="How Grass Pass uses DigitalOcean" className="grid content-start gap-3 sm:grid-cols-2">
          <Fact icon={KeyRound} title="One host gets the key">
            The DigitalOcean key is only ever sent to <code className="text-[0.85em] whitespace-nowrap">{DO_HOST}</code>.
          </Fact>
          <Fact icon={Wallet} title="Spend has a ceiling">
            Per token, on prepaid credit; at most {cap} model calls a day.
          </Fact>
          <Fact icon={Gauge} title="Measured">
            {secs(g.p50s)} a typical call. {usd(g.costPerPass)} a pass for the clue calls:{" "}
            {costMet ? "within" : <strong>missed</strong>} the {usd(EVAL_THRESHOLDS.costPerPass)} target. Trip tips add one short call.
          </Fact>
          <Fact icon={ArrowLeftRight} title="Swappable">
            <code className="text-[0.85em]">MODEL_BASE_URL</code> and <code className="text-[0.85em]">MODEL_ID</code> pick
            another host or model, under the same checks ({llama.label.split(" (")[0]} ran them in our eval).
          </Fact>
        </ul>
      ) : null}
    </div>
  );
}
