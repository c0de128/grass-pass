/**
 * Unit-test setup, loaded FIRST (vitest.config.mts setupFiles): the wall clock starts at
 * 2026-10-06 04:00 UTC (11 PM on Oct 5 in Chicago, the recording day) and keeps moving with real time.
 * That is after every saved data recording (the last, src/data/osm, 03:41 UTC) and before the Chicago
 * day ends (05:00 UTC), so "now" is later than every recorded fetch time and still the recorded day.
 *
 * Why: the pass tests replay live recordings that only exist for that day. The season check asks
 * iNaturalist about the CURRENT month (only the October answers are recorded) and the October box
 * asks for the current 14-day window (only the recorded window is answered). On the real clock, in
 * November, makePass() would see "season unknown" and no October box, and CI would go red for no
 * code change (audit R1 follow-up). A fixed offset (not vi fake timers) keeps the 1 request/second
 * slots and the deadlines live. It is installed before any app module loads, so module singletons
 * that read Date.now (stores, caches, limiters) share the same clock. Tests that need another time
 * still pass their own `now` or use vi.useFakeTimers / vi.setSystemTime on top of it.
 */
export const RECORDING_CLOCK_START = Date.UTC(2026, 9, 6, 4, 0, 0);

const RealDate = globalThis.Date;
const offset = RECORDING_CLOCK_START - RealDate.now();

class RecordingDayDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() + offset);
    else super(...(args as [string | number]));
  }
  static now(): number {
    return RealDate.now() + offset;
  }
}

globalThis.Date = RecordingDayDate as unknown as DateConstructor;
