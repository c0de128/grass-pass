import { FindAPark } from "@/components/parks/FindAPark";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-12">
      <header>
        <h1 className="text-4xl font-bold text-accent">Grass Pass</h1>
        <p className="mt-2 text-lg">Your ticket to get outside.</p>
      </header>
      <FindAPark />
    </main>
  );
}
