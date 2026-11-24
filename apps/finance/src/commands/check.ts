// `finance check`: run every queries/checks/*.sql. Each check returns ZERO rows
// when the data is healthy; any rows are problems to look at. Exits non-zero if
// any check returns rows, so a nightly job (or a human) notices.
import Table from "cli-table3";
import fs from "node:fs";
import path from "node:path";
import { FINANCE_ROOT } from "../config.js";
import { withRun } from "../db/sync-run.js";
import { cell, runSqlFileReadOnly } from "./query.js";

const CHECKS_DIR = path.join(FINANCE_ROOT, "queries", "checks");
const SHOW = 10;

export async function runChecks(): Promise<void> {
  const files = fs
    .readdirSync(CHECKS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const failed = await withRun({ job: "check" }, async () => {
    const failures: string[] = [];
    for (const f of files) {
      const { rows, fields, ms } = await runSqlFileReadOnly(path.join(CHECKS_DIR, f));
      const name = f.replace(/\.sql$/, "");
      if (rows.length === 0) {
        console.log(`✓ ${name} (${ms} ms)`);
        continue;
      }
      failures.push(`${name}: ${rows.length} rows`);
      console.log(`✗ ${name}: ${rows.length} row(s)`);
      const table = new Table({ head: fields });
      for (const r of rows.slice(0, SHOW)) table.push(fields.map((k) => cell(r[k])));
      console.log(table.toString());
      if (rows.length > SHOW) console.log(`  … ${rows.length - SHOW} more (run it with \`query queries/checks/${f} --csv\`)`);
    }
    // Recording failures on the run (not throwing) keeps sync_run "succeeded":
    // the check itself ran fine; the data is what needs attention.
    return { result: failures, error: failures.length ? failures.join("; ") : undefined };
  });

  console.log(failed.length ? `\n${failed.length} of ${files.length} checks failed.` : `\nAll ${files.length} checks passed.`);
  if (failed.length) process.exitCode = 1;
}
