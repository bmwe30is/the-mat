// Environment config, validated with zod.
//
// Config is split into sections that are each validated *lazily* (on first use),
// so a command only fails on the variables it actually needs. For example,
// `migrate` must not refuse to run just because SQUARE_ACCESS_TOKEN is empty.
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Absolute path to apps/finance, regardless of the cwd the CLI was started from. */
export const FINANCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadDotenv({ path: path.join(FINANCE_ROOT, ".env"), quiet: true });

// Treat "" the same as unset, so `KEY=` lines in .env fall back to defaults.
const env = (key: string): string | undefined => {
  const v = process.env[key];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

function lazy<T>(name: string, read: () => T): () => T {
  let cached: T | undefined;
  return () => {
    if (cached === undefined) {
      try {
        cached = read();
      } catch (err) {
        if (err instanceof z.ZodError) {
          const issues = err.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
          throw new Error(`Invalid ${name} config in apps/finance/.env:\n${issues}`);
        }
        throw err;
      }
    }
    return cached;
  };
}

export const dbConfig = lazy("database", () =>
  z
    .object({
      url: z.string().url(),
      ssl: bool.default(true),
      sslCaPath: z.string().optional(),
    })
    .parse({
      url: env("FINANCE_DATABASE_URL"),
      ssl: env("FINANCE_DB_SSL"),
      sslCaPath: env("FINANCE_DB_SSL_CA"),
    }),
);

export const acuityConfig = lazy("Acuity", () =>
  z
    .object({
      userId: z.string().min(1),
      apiKey: z.string().min(1),
      requestsPerSec: z.coerce.number().positive().default(1),
    })
    .parse({
      userId: env("ACUITY_USER_ID"),
      apiKey: env("ACUITY_API_KEY"),
      requestsPerSec: env("ACUITY_REQUESTS_PER_SEC"),
    }),
);

/**
 * Square-Version used when SQUARE_VERSION is unset. The probe reports which
 * version it ran with; copy it into .env to pin it explicitly.
 */
export const DEFAULT_SQUARE_VERSION = "2025-01-23";

export const squareConfig = lazy("Square", () =>
  z
    .object({
      accessToken: z.string().min(1),
      env: z.enum(["production", "sandbox"]).default("production"),
      // Optional so the probe can run before the location is known: it lists
      // /v2/locations and reports the id to pin. Extract (Phase 4) will require it.
      locationId: z.string().min(1).optional(),
      version: isoDate.default(DEFAULT_SQUARE_VERSION),
    })
    .parse({
      accessToken: env("SQUARE_ACCESS_TOKEN"),
      env: env("SQUARE_ENV"),
      locationId: env("SQUARE_LOCATION_ID"),
      version: env("SQUARE_VERSION"),
    }),
);

export const behaviourConfig = lazy("behaviour", () =>
  z
    .object({
      reportingTz: z.string().default("America/Los_Angeles"),
      seedStart: isoDate.default("2020-03-01"),
      seedEnd: isoDate.default("2020-12-31"),
      matchWindowMinutes: z.coerce.number().int().positive().default(15),
      membershipTypePatterns: z
        .string()
        .default("Membership")
        .transform((s) => s.split(",").map((p) => p.trim()).filter(Boolean)),
    })
    .parse({
      reportingTz: env("REPORTING_TZ"),
      seedStart: env("SEED_START"),
      seedEnd: env("SEED_END"),
      matchWindowMinutes: env("MATCH_WINDOW_MINUTES"),
      membershipTypePatterns: env("MEMBERSHIP_TYPE_PATTERNS"),
    }),
);
