import { expect, test } from "vitest";
import { envList } from "../env";
import { recordDfwParks } from "../osm-dfw-parks";
import { importRecordings, recordExamples, recordIndex } from "../osm-snapshot";

test("record the saved OpenStreetMap answers live (pnpm osm:snapshot)", async () => {
  if (process.env.OSM_SNAPSHOT_IMPORT === "1") {
    const log = importRecordings();
    process.stdout.write(`${log.join("\n")}\n`);
    return;
  }
  // Default: the example parks and the DFW index. R2-M3: dfw-features / dfw-geometry record every
  // park in the index (batched, resumable; see evals/osm-dfw-parks.ts). OSM_SNAPSHOT_LIMIT caps parks per type.
  const only = new Set(envList(process.env.OSM_SNAPSHOT_ONLY) ?? ["features", "geometry", "index"]);
  const dfw = new Set<"features" | "geometry">();
  if (only.has("dfw-features")) dfw.add("features");
  if (only.has("dfw-geometry")) dfw.add("geometry");
  const limit = Number(process.env.OSM_SNAPSHOT_LIMIT) || undefined;
  const log = [
    ...(only.has("features") || only.has("geometry") ? await recordExamples(only) : []),
    ...(only.has("index") ? await recordIndex() : []),
    ...(dfw.size > 0 ? await recordDfwParks(dfw, { limit }) : []),
  ];
  process.stdout.write(`${log.join("\n")}\n`);
  // Failures keep the earlier answers; the run itself is reported as failed.
  expect(log.filter((l) => l.includes("FAILED"))).toEqual([]);
});
