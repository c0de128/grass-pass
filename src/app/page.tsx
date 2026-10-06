import { after, connection } from "next/server";
import { ExampleParks } from "@/components/ExampleParks";
import { Hero } from "@/components/Hero";
import { PassMaker } from "@/components/pass/PassMaker";
import { exampleStatuses, prewarmIdle } from "@/lib/prewarm";

/** A background example refresh (one real pass) may run after the page is sent. */
export const maxDuration = 90;

export default async function Home() {
  // Request-time: example status is read from the shared store on every visit (never baked at build).
  await connection();
  const statuses = await exampleStatuses();
  // Keep any background refresh this visit started alive after the response (serverless).
  after(() => prewarmIdle());
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-5 py-8">
      <Hero title="Your ticket to get outside." lead="Pick a park. Print a pass. Phone away.">
        <p className="text-base">
          Just looking?{" "}
          <a href="#examples-title" className="font-semibold underline">
            See a real example pass
          </a>
          .
        </p>
        <PassMaker />
      </Hero>
      <ExampleParks statuses={statuses} />
    </main>
  );
}
