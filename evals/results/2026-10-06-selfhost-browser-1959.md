# Self-hosted Gemma 4 E2B in the browser, with the longer local clock (2026-10-06, 7:59 PM CDT)

Judge item G2 asked: the README's run-it-yourself steps used the app's 70 s limit, which gave 0 of 5 complete passes on
a laptop CPU, and the browser flow was never clicked through. This is that click-through. **One run, not a benchmark.**
Raw server log lines (no keys, no addresses): [`2026-10-06-selfhost-browser-1959.json`](2026-10-06-selfhost-browser-1959.json).

| | |
|---|---|
| App | production build (`next start`) of the code that adds `LOCAL_MODEL_TIMEOUT_MS` (src/lib/pass/local-clock.ts), http://localhost:3440 |
| Model | `gemma4-e2b-8k` = `gemma4:e2b-it-qat` (Gemma 4 E2B, Apache-2.0) with an 8,192-token context ([`../selfhost/Modelfile`](../selfhost/Modelfile)) |
| Runner and hardware | Ollama 0.32.15, CPU only, on the same Windows 11 laptop as the eval runs (Intel Core Ultra 7 155H, 32 GB RAM, no NVIDIA GPU) |
| Settings | `MODEL_BASE_URL=http://localhost:11434/v1`, `MODEL_ID=gemma4-e2b-8k`, `MODEL_REASONING_EFFORT=none`, `LOCAL_MODEL_TIMEOUT_MS=270000` (4.5 min a call, 3 min a refill, 10 min a pass, the page waits 10 min 10 s) |
| What I did | signed in with **Try as a judge**, searched "Celebration Park Allen TX" (8.5 s), picked Celebration Park, ages 6-10, pressed **Make my pass** |
| While waiting | the page said "A model on this computer can take a few minutes. This page waits for it." |
| Result | the pass page opened **96 s** after the press (server: 94.6 s). **7 of 8 finds** (a complete pass by the eval's n-1 rule), all Park Finds, plus a Find This Spot riddle and map and the October monarch box |
| Model calls | 2: the first took 62.8 s and kept 6 of 8; a refill took 30.7 s and kept 1 more (the checks dropped 5 clues for repeating an opening) |
| Wild Finds | "No data available: no research-grade sightings within 1.5 km in the last 14 days on iNaturalist." (the data, not the model) |
| Cost | $0 (0 DigitalOcean calls, 0 SerpApi searches) |

**With the normal clock this pass would not have finished as shown:** after the first call about 20 s of the 85 s pass
deadline were left, so the refill would have been cut off at about 17 s (it took 30.7 s) and the pass would have printed
6 of 8; and the page stops waiting at 95 s. Other programs were running on the laptop, so the time is one honest
example, not a benchmark.
