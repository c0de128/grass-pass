"use client";

/**
 * Search v2 (Kevin 2026-10-10: "could we also add a map?"): a real street map of the search results. MapLibre GL JS
 * (BSD-3) draws OpenFreeMap's Positron streets (OpenStreetMap data); on top: the searched place, the chosen circle,
 * and numbered pins that match the numbered list. Loaded only after results exist (next/dynamic in ParkStep), so the
 * home page's first load does not carry it.
 *
 * Accessibility: the numbered list is the main, complete control. The map is a labelled region and a picture of the
 * same list: its pins are hidden from screen readers and not in the tab order (a pin click calls the same onPick as
 * the card); the only focusable parts are the zoom buttons, so it is never a keyboard trap. No camera animations at
 * all (the first view is set without motion; reduced motion also turns off drag inertia and label fades).
 * If the style or tiles can't load (or WebGL is missing), a short note says so and the list carries on.
 */
import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MlMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSourceSpecification } from "maplibre-gl";
import { useEffect, useId, useRef, useState } from "react";
import { MAP_COPY, MAP_LOAD_TIMEOUT_MS, MAPLIBRE_WORKER_URL, OPENFREEMAP_STYLE_URL } from "@/lib/parks/map-config";
import { circleRing, milesShort, resultsBounds } from "@/lib/parks/results-view";
import type { Park } from "@/lib/parks/schema";

export type MapPark = Pick<Park, "id" | "lat" | "lng" | "distanceM"> & { label: string };

type Props = {
  center: { lat: number; lng: number };
  radiusM: number;
  parks: MapPark[];
  activeId: string | null;
  onActive: (id: string | null) => void;
  onPick: (id: string) => void;
};

const RING = "#137838";

export default function ParkResultsMap({ center, radiusM, parks, activeId, onActive, onPick }: Props) {
  const ids = useId();
  const helpId = `${ids}-help`;
  const boxRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  // Latest callbacks, so the map is built once per result list and never rebuilt for a new function identity.
  const cb = useRef({ onActive, onPick });
  useEffect(() => {
    cb.current = { onActive, onPick };
  });

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    let map: MlMap | null = null;
    let loaded = false;
    let gone = false;
    /** Street tiles: did any arrive, and how many failed. A map whose tiles all fail is "unavailable" too. */
    let tileOk = false;
    let tileErrors = 0;
    const fail = (evenIfLoaded = false) => {
      if (gone || (loaded && !evenIfLoaded)) return;
      gone = true;
      clearTimeout(timer);
      setState("failed");
      map?.remove();
      map = null;
    };
    const timer = setTimeout(() => fail(), MAP_LOAD_TIMEOUT_MS);

    try {
      setWorkerUrl(MAPLIBRE_WORKER_URL);
      const [sw, ne] = resultsBounds(center, parks);
      map = new MlMap({
        container: box,
        style: OPENFREEMAP_STYLE_URL,
        bounds: [sw, ne],
        fitBoundsOptions: { padding: 36, maxZoom: 15 },
        attributionControl: false,
        keyboard: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        cooperativeGestures: true,
        reduceMotion: reduce || undefined,
        fadeDuration: reduce ? 0 : 300,
        maxZoom: 17,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new NavigationControl({ showCompass: false }), "top-right");
      // The canvas is a picture of the list: out of the tab order and hidden from screen readers (the region is labelled).
      const canvas = map.getCanvas();
      canvas.setAttribute("tabindex", "-1");
      canvas.setAttribute("aria-hidden", "true");

      map.on("data", (e) => {
        if (e.dataType === "source" && "tile" in e && e.tile) tileOk = true;
      });
      map.on("error", (e) => {
        // The style, its sprite or fonts failed: no map. A tile failed: only when no tile has worked at all.
        if (!("sourceId" in e) || !e.sourceId) return fail(true);
        tileErrors += 1;
        if (!tileOk && tileErrors >= 2) fail(true);
      });
      map.on("load", () => {
        if (!map || gone) return;
        loaded = true;
        clearTimeout(timer);
        const circle: GeoJSONSourceSpecification = {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circleRing(center, radiusM)] } },
        };
        map.addSource("gp-radius", circle);
        map.addLayer({ id: "gp-radius-fill", type: "fill", source: "gp-radius", paint: { "fill-color": RING, "fill-opacity": 0.07 } });
        map.addLayer({
          id: "gp-radius-line",
          type: "line",
          source: "gp-radius",
          paint: { "line-color": RING, "line-width": 2.5, "line-dasharray": [2, 1.5], "line-opacity": 0.9 },
        });
        setState("ready");
      });

      const home = document.createElement("div");
      home.className = "gp-map-home";
      home.setAttribute("aria-hidden", "true");
      home.title = "Your search";
      new Marker({ element: home }).setLngLat([center.lng, center.lat]).addTo(map);

      // Nearest last, so pin 1 is drawn on top when pins overlap.
      [...parks].reverse().forEach((p) => {
        const n = parks.indexOf(p) + 1;
        const el = document.createElement("div");
        el.className = "gp-map-pin";
        el.dataset.parkId = p.id;
        el.setAttribute("aria-hidden", "true");
        el.title = `${n}. ${p.label}, ${milesShort(p.distanceM)}`;
        const num = document.createElement("span");
        num.textContent = String(n);
        el.appendChild(num);
        el.addEventListener("mouseenter", () => cb.current.onActive(p.id));
        el.addEventListener("mouseleave", () => cb.current.onActive(null));
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          cb.current.onPick(p.id);
        });
        new Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map!);
      });
    } catch {
      // No WebGL, or the library could not start: the list is still complete.
      fail();
    }

    return () => {
      gone = true;
      clearTimeout(timer);
      map?.remove();
    };
    // Built once per result list (ParkStep remounts this component with a key for each new answer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A hovered or focused card lights up its pin (and the pin's hover lights up the card, via onActive).
  useEffect(() => {
    const pins = boxRef.current?.querySelectorAll<HTMLElement>(".gp-map-pin") ?? [];
    for (const el of pins) el.setAttribute("data-active", el.getAttribute("data-park-id") === activeId ? "true" : "false");
  }, [activeId, state]);

  if (state === "failed") {
    return (
      <p className="rounded-2xl bg-muted p-3 text-sm font-semibold" data-testid="park-map-unavailable">
        {MAP_COPY.unavailable}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="region"
        aria-label={MAP_COPY.region}
        aria-describedby={helpId}
        aria-busy={state === "loading" || undefined}
        className="relative h-64 overflow-hidden rounded-2xl bg-[#edf4e2] ring-1 ring-border sm:h-80"
        data-testid="park-map"
        data-state={state}
      >
        <div ref={boxRef} className="absolute inset-0" />
        {state === "loading" ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-[#10291a]">Loading the street map…</p>
        ) : null}
      </div>
      <p id={helpId} className="text-xs text-muted-foreground">
        {MAP_COPY.help} Map:{" "}
        <a className="underline" href="https://openfreemap.org">
          OpenFreeMap
        </a>{" "}
        <a className="underline" href="https://www.openmaptiles.org/">
          © OpenMapTiles
        </a>{" "}
        Data from{" "}
        <a className="underline" href="https://www.openstreetmap.org/copyright">
          OpenStreetMap
        </a>
        .
      </p>
    </div>
  );
}
