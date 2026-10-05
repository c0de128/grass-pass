export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-12">
      <header>
        <h1 className="text-4xl font-bold text-accent">Grass Pass</h1>
        <p className="mt-2 text-lg">Your ticket to get outside.</p>
      </header>
      <section aria-labelledby="parks-heading" className="rounded-xl border-2 border-accent p-5">
        <h2 id="parks-heading" className="text-xl font-semibold">
          Parks
        </h2>
        <p role="status" className="mt-2">
          No data available: park search is not switched on in this build yet, so there are no parks to show. Check
          back soon.
        </p>
      </section>
    </main>
  );
}
