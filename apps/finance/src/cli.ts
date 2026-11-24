// Entry point: `npm run finance -- <command>` (from the repo root).
import { Command, InvalidArgumentError } from "commander";
import { runChecks } from "./commands/check.js";
import { runQuery } from "./commands/query.js";
import { runProbe } from "./probe/probe.js";
import { runAcuityExtract } from "./sources/acuity/extract.js";
import { runSquareExtract } from "./sources/square/extract.js";
import { migrate, resetSchema } from "./db/migrate.js";
import { closePool } from "./db/pool.js";
import { logger } from "./lib/logger.js";
import { runReconcile } from "./reconcile/run.js";
import { runTransform, SPECS } from "./transform/load.js";

const program = new Command()
  .name("finance")
  .description("Acuity + Square ingestion and reconciliation (docs/finance/PRD-finance-ledger.md)")
  .showHelpAfterError();

const positiveInt = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError("must be a positive integer");
  return n;
};
const collect = (v: string, prev: string[]) => [...prev, v];

program
  .command("migrate")
  .description("apply db/migrations/*.sql in order")
  .option("--dry-run", "list pending migrations without applying them")
  .option("--reset", "DROP the finance schema first (local dev only; needs --yes + confirmation)")
  .option("--yes", "confirm --reset")
  .action(async (opts: { dryRun?: boolean; reset?: boolean; yes?: boolean }) => {
    if (opts.reset) await resetSchema({ yes: opts.yes });
    const { applied } = await migrate({ dryRun: opts.dryRun });
    if (applied.length) logger.info({ applied }, `applied ${applied.length} migration(s)`);
  });

program
  .command("query")
  .description("run a read-only report .sql file")
  .argument("<file>", "path to a .sql file, e.g. queries/exceptions.sql")
  .option("--from <date>", "LA local date, inclusive (default SEED_START)")
  .option("--to <date>", "LA local date, inclusive (default SEED_END)")
  .option("--param <name=value>", "extra :named param (repeatable)", collect, [])
  .option("--csv", "write out/<file>_<from>_<to>.csv instead of printing")
  .option("--limit <n>", "max rows printed to the console", positiveInt, 50)
  .option("--explain", "print EXPLAIN ANALYZE instead of rows")
  .option("--sample <n>", "keep a repeatable pseudo-random sample of n rows (e.g. ledger spot-checks)", positiveInt)
  .action(runQuery);

program
  .command("probe")
  .description("sample both APIs and write docs/finance/probe-findings.md (PRD §14)")
  .option("--from <date>", "start of the early window (LA local date)", "2020-03-01")
  .option("--to <date>", "end of the early window (LA local date)", "2020-03-31")
  .option("--recent <YYYY-MM>", "recent month to compare against (default: last full month)")
  .option("--sample <n>", "paid Acuity appointments to fetch payments for", positiveInt, 60)
  .option("--from-cache <dir>", "re-analyze a saved data/probe/<run> folder without calling the APIs")
  .action(runProbe);

program
  .command("extract")
  .description("land API data in finance.raw_record (idempotent, resumable)")
  .requiredOption("--source <source>", "acuity | square | all")
  .option("--from <date>", "LA local date, inclusive (default SEED_START)")
  .option("--to <date>", "LA local date, inclusive (default SEED_END)")
  .option("--resume", "continue after the last completed month")
  .option("--dry-run", "fetch and diff, but write nothing")
  .option("--refresh-payments", "Acuity: re-fetch payments for every paid appointment, not just new/changed ones")
  .option("--refresh-customers", "Square: re-fetch every referenced customer, not just ones not stored yet")
  .action(
    async (opts: {
      source: string;
      from?: string;
      to?: string;
      resume?: boolean;
      dryRun?: boolean;
      refreshPayments?: boolean;
      refreshCustomers?: boolean;
    }) => {
      if (!["acuity", "square", "all"].includes(opts.source)) throw new Error(`--source must be acuity, square or all`);
      if (opts.source === "acuity" || opts.source === "all") await runAcuityExtract(opts);
      if (opts.source === "square" || opts.source === "all") await runSquareExtract(opts);
    },
  );

program
  .command("transform")
  .description("rebuild staging tables from raw_record (one transaction)")
  .option("--entity <key>", `rebuild one entity only: ${SPECS.map((s) => s.key).join(" | ")}`)
  .option("--dry-run", "do the rebuild, report counts, then roll it back")
  .action(runTransform);

program
  .command("check")
  .description("run queries/checks/*.sql; exit 1 if any returns rows")
  .action(runChecks);

program
  .command("reconcile")
  .description("match Acuity ⇄ Square and classify every record (rewrites recon_link + recon_status)")
  .option("--from <date>", "status window start, LA local date (default SEED_START)")
  .option("--to <date>", "status window end, LA local date (default SEED_END)")
  .option("--dry-run", "reconcile and report, then roll back")
  .action(runReconcile);

program
  .command("run")
  .description("extract (all) → transform → reconcile → check: what a nightly job will call")
  .option("--from <date>", "LA local date, inclusive (default SEED_START)")
  .option("--to <date>", "LA local date, inclusive (default SEED_END)")
  .action(async (opts: { from?: string; to?: string }) => {
    await runAcuityExtract(opts);
    await runSquareExtract(opts);
    await runTransform({});
    await runReconcile(opts);
    await runChecks();
  });

try {
  await program.parseAsync();
} catch (err) {
  logger.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
