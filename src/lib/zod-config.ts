/**
 * Zod 4 probes for `new Function` support (to JIT-compile object parsers).
 * Under our CSP (no 'unsafe-eval') Chrome logs that probe as a CSP violation
 * even though Zod catches it. `jitless` skips the probe; parsing is unchanged.
 * Import this module before any schema is used (shared schema modules import it).
 */
import { z } from "zod";

z.config({ jitless: true });

export { z };
