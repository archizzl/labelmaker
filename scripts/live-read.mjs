/*
 * `node scripts/live-read.mjs "<sql>"`: run one query against the live database, read-only, and
 * print the rows as JSON. Used by the live-db-reader agent (.claude/agents/live-db-reader.md).
 *
 * - The query runs inside `begin read only` and is always rolled back, so Postgres refuses writes.
 * - Columns that hold people's contact details, sign-in secrets or tokens are blanked out by name
 *   (emails, buyer names, addresses, phones, passwords, tokens, secrets).
 * - At most 200 rows are printed, and the query is stopped after 15 seconds.
 *
 * Reads PRODUCTION_DATABASE_URL from .deploy.local. LIVE_READ_URL points it at another database
 * instead (to try the script on a local copy).
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const sql = process.argv[2];
if (!sql) {
  console.error('Usage: node scripts/live-read.mjs "select …"');
  process.exit(1);
}

const url =
  process.env.LIVE_READ_URL ??
  readFileSync(".deploy.local", "utf8").match(/^PRODUCTION_DATABASE_URL=(.+)$/m)?.[1]?.trim();
if (!url) {
  console.error("Put PRODUCTION_DATABASE_URL in .deploy.local");
  process.exit(1);
}

const MAX_ROWS = 200;
const PRIVATE = /email|buyer_name|address|phone|password|token|secret|user_agent/i;
const isPrivate = (column) => PRIVATE.test(column) && !/_at$/i.test(column);

// pg already treats these as verify-full; saying so outright keeps it from warning on every run.
const client = new pg.Client({ connectionString: url.replace(/sslmode=(prefer|require|verify-ca)\b/, "sslmode=verify-full") });
await client.connect();
try {
  await client.query("begin read only");
  await client.query("set local statement_timeout = '15s'");
  const result = await client.query(sql);
  const rows = (result.rows ?? []).slice(0, MAX_ROWS).map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, isPrivate(k) && v != null ? "[hidden]" : v])),
  );
  console.log(JSON.stringify(rows, null, 2));
  const total = result.rowCount ?? rows.length;
  if (total > MAX_ROWS) console.log(`(${total} rows; showing the first ${MAX_ROWS})`);
} catch (error) {
  console.error(`Query failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
