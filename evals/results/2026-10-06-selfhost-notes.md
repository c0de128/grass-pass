# Self-hosted Gemma 4 on a laptop CPU (2026-10-06, Dallas time)

Judge item G1 asked: "run it yourself" is claimed but not measured. This is the measurement. **Two partial runs, 5 parks,
one run each, age band 6-10, $0 (no paid call).** Not the frozen numbers; the 20-park hosted run `2026-10-06-6` still is.

- **App clock** (what you get if you run the app with these settings): [`2026-10-06-selfhost-1656.md`](2026-10-06-selfhost-1656.md)
- **Patient clock** (eval only, the model is not cut off): [`2026-10-06-selfhost-patient-1704.md`](2026-10-06-selfhost-patient-1704.md)

## What ran

| | |
|---|---|
| Model | Gemma 4 E2B, instruction-tuned, QAT 4-bit (`gemma4:e2b-it-qat`, Ollama digest `07ea59a47401`, 4.3 GB; 4.6B parameters per `ollama show` (2.3B "effective" per the Ollama library page), Q4_0) |
| Why this tag | The smallest Gemma 4 in the Ollama library on 2026-10-06 (`e2b-it-q4_K_M` is 4.6 GB, `e4b-it-qat` 6.1 GB) |
| Licence | Apache-2.0 (`ollama show gemma4:e2b-it-qat --license` prints the Apache License 2.0 text) |
| Served as | `gemma4-e2b-8k`: the same weights re-tagged with an 8,192-token context ([`../selfhost/Modelfile`](../selfhost/Modelfile)). Ollama's default context here was 4,096, and our longest prompt is 3,801 tokens before the 1,200-token answer budget, so the default would cut the prompt |
| Thinking | Off (`MODEL_REASONING_EFFORT=none` -> `reasoning_effort: "none"`). Ollama turns Gemma 4's thinking ON by default through its OpenAI API: a 3-clue test took 21.9 s with thinking and 2.9 s without |
| Server | Ollama 0.32.15, `http://localhost:11434/v1`, the app's own OpenAI-compatible client (`src/lib/model.ts`), strict JSON schema |
| Hardware | Windows 11 laptop, Intel Core Ultra 7 155H (16 cores / 22 threads), 31.5 GB RAM, **no NVIDIA GPU**: Ollama reported "100% CPU" |
| Code | the real pass builder (`buildPass`) on the recorded fixtures, scored by `evals/score.ts`, like every other run |
| Parks | Connemara Meadow Preserve, Celebration Park, Arbor Hills Nature Preserve, White Rock Lake Park, Cedar Ridge Preserve (cases 1, 2, 3, 13, 15) |

## Results

| | App clock (70 s per call, 85 s per pass) | Patient clock (eval only) | Gemma 4 31B hosted, 20 parks (`2026-10-06-6`) |
|---|---|---|---|
| Passes made | **2 of 5** (3 hit the 70 s limit) | 5 of 5 | no pass lost (60 runs) |
| Complete passes (n-1 or more) | **0 of 5** (both 6/8) | 4 of 5 (80%; Arbor Hills 6/8) | 94.1% |
| Grounded, before the filter | 100% (16/16) | 96.7% (59/61) | 99.6% |
| Blocked species printed | 0 | 0 | 0 |
| Name leaks, before the filter | 0% (0/16) | 4.9% (3/61), all removed | 2.6% |
| Wrong counts printed | 0 (no count clues) | 0 of 1 (1 removed by the check) | 0 of 96 |
| Reading grade (median) | 2.5 (12 clues) | 2.9 (35 clues) | 2.5 |
| Clues repeated across parks | 0% (0/12) | 0% (0/35) | 5.1% (20 parks x 3 runs; not comparable with 5 parks x 1) |
| Model time per call p50 / p95 | 68.0 s / 70.0 s (timeouts) | **59.3 s / 84.8 s** | 12.0 s / 22.7 s |
| Model time per pass p50 | 70.0 s | 104.1 s (one call 74.8 s; three calls 182.7 s) | 14.5 s |
| Calls | 6 (2 answered) | 10 (all answered; 4 passes needed a refill, 1 needed two) | 80 |
| Cost | $0 | $0 | $0.00097 a pass |

**Speed on this CPU.** First calls took 57.5-87.3 s (prompts 2,226-3,801 tokens, answers 649-826 tokens). Measured
directly on the real Arbor Hills request: reading the prompt ran at **99.6 tokens/s** (3,308 tokens in 33.2 s, cold)
and writing at **17.9 answer tokens/s** (785 tokens in 43.8 s). End to end, answer tokens / wall time: median 8.7 tok/s
(6.8-11.8), because the prompt has to be read first. Hosted Gemma 4 31B ran at 36.8.

**Memory and load.** Ollama's model runner (`llama-server`) held 4.9-5.2 GB in RAM (working set; 5.8 GB private bytes at most; GB = 1,024 MB as Windows counts).
System free RAM went from 11.4 GB to 5.2 GB at its lowest. CPU load: median 67%, p95 94% (sampled every 2 s over the
10-minute patient run). The laptop stayed usable; no call came near the 5-minute stop line (slowest 87.3 s).
Other programs were running at the same time, so the load figures are not a clean benchmark.

## What this means

- **It runs, for $0, on a laptop with no GPU, and the safety and grounding checks hold** (0 blocked species printed,
  96.7-100% grounded before the filter).
- **With the app's own time limits it is too slow on this CPU:** 3 of 5 first calls hit the 70 s cap and the 2
  passes that finished were short (6/8). The app's 70 s cap and 85 s pass deadline exist because the hosted route
  runs on Vercel with a 90 s limit, and the page itself gives up after 95 s.
- **Given time, the small model writes usable passes:** 4 of 5 complete, reading grade 2.9, at about 1-3 minutes a
  pass. A GPU, or a faster CPU, would be needed for the app's normal wait.
- The patient clock is an eval setting (`EVAL_LOCAL_PATIENT=1`), not an app setting: the app never waits longer than
  70 s for a model call.

## Reproduce (free, about 20 minutes, ~4.3 GB download)

```bash
ollama pull gemma4:e2b-it-qat
ollama create gemma4-e2b-8k -f evals/selfhost/Modelfile
pnpm install
pnpm eval:check                                                   # free dry run, model off
EVAL_MODELS=gemma4-e2b-8k EVAL_CASES=1,2,3,13,15 pnpm eval        # app clock
EVAL_MODELS=gemma4-e2b-8k EVAL_CASES=1,2,3,13,15 EVAL_LOCAL_PATIENT=1 pnpm eval   # patient clock
```

No key is needed and nothing leaves the machine (the park data comes from the recorded fixtures). `EVAL_LOCAL_BASE_URL`
points the lane at another local server (plain http only for localhost / 127.0.0.1).
