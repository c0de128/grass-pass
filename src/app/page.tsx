import { Hero } from "@/components/Hero";
import { PassMaker } from "@/components/pass/PassMaker";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-5 py-8">
      <Hero title="Your ticket to get outside." lead="Pick a park. Print a pass. Phone away.">
        <PassMaker />
      </Hero>
    </main>
  );
}
