/**
 * Park Finds pool (SPEC F3): one item per kind of mapped feature inside the park, with a
 * code-written fact sheet ("Celebration Park has 2 basketball courts on the map (OpenStreetMap).")
 * plus a fixed kid-level description of that kind. Counts come from OSM; nothing is invented.
 */
import { FEATURE_KINDS, FEATURE_KIND_IDS, type FeatureKind, type ParkFeatures } from "@/lib/sources/overpass-features";
import { hasUrlOrMarkup } from "@/lib/ai/validate";
import { distinctiveWords, type PoolItem, type SectionState } from "./types";

/** SPEC §5.4, Park Finds empty copy. */
export function parkFindsEmptyCopy(parkName: string): string {
  return `No data available: OpenStreetMap has no mapped playgrounds, courts or shelters inside ${parkName}.`;
}

/** Kinds where a count is misleading (one creek is often mapped as several pieces). */
const NO_COUNT: ReadonlySet<FeatureKind> = new Set(["creek"]);

/** Fixed ordering: play and sport first, then landmarks, then nature features. */
const ORDER: readonly FeatureKind[] = FEATURE_KIND_IDS;

function countPhrase(kind: FeatureKind, count: number): string {
  const info = FEATURE_KINDS[kind];
  if (NO_COUNT.has(kind)) return `a ${info.label}`;
  if (count === 1) return `1 ${info.label}`;
  return `${count} ${info.plural}`;
}

export function parkPool(f: ParkFeatures): { items: PoolItem[]; state: SectionState } {
  const items: PoolItem[] = [];
  for (const kind of ORDER) {
    const entry = f.features[kind];
    if (!entry || entry.count < 1) continue;
    const info = FEATURE_KINDS[kind];
    // R1-m7: anyone can edit an OSM name. A name with a link, domain, @handle or phone-like digits
    // ("Text 555 0100 for a prize at kidsprize.com") never reaches the prompt or the answer key.
    const names = entry.names.filter((nm) => !hasUrlOrMarkup(nm));
    const named = names.length > 0 ? ` Mapped name${names.length > 1 ? "s" : ""}: ${names.join(", ")}.` : "";
    const sourceText = `${f.park.name} has ${countPhrase(kind, entry.count)} on the map (OpenStreetMap).${named} ${info.describe}`;
    const evidence = NO_COUNT.has(kind)
      ? "on the park map · OpenStreetMap"
      : entry.count === 1
        ? "1 on the park map · OpenStreetMap"
        : `${entry.count} on the park map · OpenStreetMap`;
    const what = capitalize(entry.count > 1 && !NO_COUNT.has(kind) ? info.plural : info.label);
    const answer = names.length > 0 ? `${what} (${names.join(", ")})` : what;
    items.push({
      id: `osm-${kind.replace(/_/g, "-")}`,
      section: "park",
      kind: info.label,
      sourceText,
      answer,
      evidence,
      source: "OpenStreetMap",
      nameWords: [...new Set([...info.nameWords.map((w) => w.toLowerCase()), ...names.flatMap((nm) => distinctiveWords(nm, { place: true }))])],
      safety: kind === "water" || kind === "creek" ? "Stay with your grown-up near water." : null,
      stationary: true,
    });
  }
  return items.length > 0 ? { items, state: { status: "ok" } } : { items, state: { status: "empty", message: parkFindsEmptyCopy(f.park.name) } };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
