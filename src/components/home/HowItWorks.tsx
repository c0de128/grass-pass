import { ArrowRight, MapPinned, Printer, Smartphone, Sparkles, type LucideIcon } from "lucide-react";
import Link from "next/link";

type Step = { icon: LucideIcon; title: string; body: string; ticker?: readonly string[] };

/**
 * Kevin's v0 copy, checked against what the app really does (times from PASS_WAIT_COPY and the eval
 * run; steps from the pass builder's real progress lines, src/lib/ai/build-pass.ts stepText).
 */
export const HOW_STEPS: readonly Step[] = [
  {
    icon: MapPinned,
    title: "Pick a park & age",
    body: "Type a town, ZIP or park name, or tap Use my location. Then pick 4–6, 6–10 or 10–13: it sets how many clues and how hard.",
  },
  {
    icon: Sparkles,
    title: "AI builds the hunt",
    body: "Gemma writes, code checks. Gemma 4 picks a fair mix from the park’s real map and 14 days of nearby sightings, then writes the clues. Code checks each one against its source. Usually 10–30 seconds.",
    ticker: ["Reading the park map…", "Checking what people spotted…", "Writing clues…"],
  },
  {
    icon: Printer,
    title: "Print the page",
    body: "One black-and-white Letter page: the kid’s pass on top, a tear line, and a grown-up stub with the answers and sources.",
  },
  {
    icon: Smartphone,
    title: "Hide the phone",
    body: "Phone away. Kids tick off finds with a pencil while you keep the stub for hints (and sanity).",
  },
];

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="relative scroll-mt-28 sm:scroll-mt-16">
      <div className="mx-auto flex max-w-7xl flex-col gap-14 px-5 py-24 md:px-8 lg:py-32">
        <div className="flex max-w-3xl flex-col gap-4">
          <p className="text-xs font-bold tracking-widest text-primary uppercase">How it works</p>
          <h2 id="how-title" className="flex flex-col gap-2 text-4xl leading-[1.05] font-extrabold tracking-tight text-ink sm:text-5xl lg:text-6xl">
            <span>Real park data in.</span>{" "}
            <span className="text-primary">Advanced AI processing.</span>{" "}
            <span>
              <span className="relative inline-block">
                Screen-free adventure
                <svg aria-hidden="true" viewBox="0 0 300 20" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-3 w-full text-sun sm:h-4">
                  <path d="M2 14 C 80 4, 200 4, 298 12" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
                </svg>
              </span>{" "}
              out.
            </span>
          </h2>
          <p>
            <Link href="/how-it-works" className="group inline-flex min-h-11 items-center gap-2 font-semibold text-link underline underline-offset-4">
              The full story for curious grown-ups: the data, the AI and every check
              <ArrowRight className="size-4 transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </p>
        </div>

        <ol className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {HOW_STEPS.map((step, index) => (
            <li
              key={step.title}
              className="relative flex flex-col gap-5 rounded-3xl bg-card p-6 ring-1 ring-border transition-transform motion-safe:hover:-translate-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                  <step.icon className="size-6" aria-hidden="true" />
                </span>
                <span className="font-heading text-5xl leading-none font-extrabold text-muted" aria-hidden="true">
                  {index + 1}
                </span>
              </div>
              <h3 className="text-xl font-extrabold text-ink">
                <span className="sr-only">Step {index + 1}: </span>
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              {step.ticker ? (
                <ul aria-label="What you see while it works" className="mt-auto flex flex-col gap-1.5 rounded-2xl bg-muted p-3 text-xs font-medium text-ink">
                  {step.ticker.map((line, i) => (
                    <li key={line} className="flex items-center gap-2">
                      <span
                        className={`size-2 rounded-full ${i === step.ticker!.length - 1 ? "bg-sun ring-2 ring-ink/20 motion-safe:animate-pulse" : "bg-primary"}`}
                        aria-hidden="true"
                      />
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
