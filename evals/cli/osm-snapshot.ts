import { expect, test } from "vitest";
import { envList } from "../env";
import { importRecordings, recordExamples, recordIndex } from "../osm-snapshot";

test("record the saved OpenStreetMap answers live (pnpm osm:snapshot)", async () => {
  if (process.env.OSM_SNAPSHOT_IMPORT === "1") {
    const log = importRecordings();
    process.stdout.write(`${log.join("\n")}\n`);
    return;
  }
  const only = new Set(envList(process.env.OSM_SNAPSHOT_ONLY) ?? ["features", "geometry", "index"]);
  const log = [...(only.has("features") || only.has("geometry") ? await recordExamples(only) : []), ...(only.has("index") ? await recordIndex() : [])];
  process.stdout.write(`${log.join("\n")}\n`);
  // Failures keep the earlier answers; the run itself is reported as failed.
  expect(log.filter((l) => l.includes("FAILED"))).toEqual([]);
});
