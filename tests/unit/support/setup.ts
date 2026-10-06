/**
 * Unit-test setup (vitest.config.mts setupFiles). Background refreshes of saved OpenStreetMap answers
 * (src/lib/sources/osm-refresh.ts) are off by default so a test's request log only shows the requests
 * it made; tests of the refresh switch them on. Saved answers (src/data/osm) stay on; tests of the
 * live Overpass path for the example parks call disableSavedOsmForTests().
 */
import { setBackgroundRefreshForTests } from "@/lib/sources/osm-refresh";

setBackgroundRefreshForTests(false);

// Accounts: sign-in cookies in unit tests are made and read with this secret (tests/unit/support/session.ts).
process.env.AUTH_SECRET = "unit-test-auth-secret-not-a-real-one-0123456789"; // gitleaks:allow
