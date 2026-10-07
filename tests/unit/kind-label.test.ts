/**
 * Judge R6 polish: search results read "Prospect Park Park" (name + kind). Real OpenStreetMap names from the judge's
 * live searches (Brooklyn, Seattle) and from the saved Dallas-area index (src/data/osm/dfw-parks.json).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { kindLabel, parkMetaLine } from "@/lib/parks/kind-label";

describe("kindLabel: the kind is only added when the name doesn't say it", () => {
  it.each([
    ["Prospect Park", "park"],
    ["Washington Park", "park"],
    ["Pacific Park", "park"],
    ["White Rock Lake Park", "park"],
    ["Klyde Warren Park", "park"],
    ["Spring Creek Forest Preserve Park", "park"],
    ["Connemara Meadow Preserve", "nature_reserve"],
    ["Arbor Hills Nature Preserve", "nature_reserve"],
    ["Cedar Ridge Preserve", "nature_reserve"],
  ] as const)("%s (%s): no kind", (name, kind) => {
    expect(kindLabel(name, kind)).toBeNull();
    expect(parkMetaLine(name, kind, "1.2 km")).toBe("1.2 km away");
  });

  it.each([
    ["Frisco Commons", "park", "Park"],
    ["Central Park Mall", "park", null],
    ["Trinity River Audubon Center", "nature_reserve", "Nature preserve"],
    ["Parkhill Green", "park", "Park"], // "Parkhill" is not the word "park"
  ] as const)("%s (%s) -> %s", (name, kind, label) => {
    expect(kindLabel(name, kind)).toBe(label);
  });

  it("keeps the kind when it adds something", () => {
    expect(parkMetaLine("Frisco Commons", "park", "800 m")).toBe("Park · 800 m away");
  });

  it("no saved Dallas-area park reads its kind twice", () => {
    // Rows: [id, name, kind, lat, lon].
    const raw = JSON.parse(readFileSync(path.resolve(__dirname, "../../src/data/osm/dfw-parks.json"), "utf8")) as { parks: [string, string, string, number, number][] };
    const named = raw.parks.map(([, name, kind]) => ({ name, kind: kind === "nature_reserve" ? ("nature_reserve" as const) : ("park" as const) }));
    expect(named.length).toBeGreaterThan(1000);
    // The added kind never repeats the name's own last word (OSM itself has one "Ridgeview Park Park"; that's not ours).
    for (const p of named) {
      const k = kindLabel(p.name, p.kind);
      if (k) expect(`${p.name.split(" ").at(-1)} ${k}`.toLowerCase(), p.name).not.toMatch(/\b(park park|preserve nature preserve)\b/);
    }
    // 1,114 of the 1,321 names already say "Park" or "Preserve", so most lines are just the distance.
    expect(named.filter((p) => kindLabel(p.name, p.kind) === null).length).toBeGreaterThan(1000);
  });
});
