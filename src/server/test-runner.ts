import "server-only";
import { onCloudflare } from "@/db";

/*
 * The test suite, for the admin dashboard's Tests tab on a local copy (`npm run dev`) only: never on
 * the live site, which can't run it (and whose data the tests would write over). The tests run as
 * `npm test` does, each file in its own in-memory database, in a child process started with none of
 * the app's settings (its database address, keys). The latest result of each test is kept in
 * .test-runs/ (not committed), so the tab shows how each one did last time.
 */

/** Whether the tests can be listed and run here: a local copy started with `npm run dev`. */
export const testsAvailable = () => process.env.NODE_ENV === "development" && !onCloudflare;

export type TestStatus = "passed" | "failed" | "skipped";
export type TestResult = { status: TestStatus; ms: number; failure: string | null; at: string };
export type TestFile = { file: string; tests: string[]; error: string | null };
export type TestRun = { at: string; ms: number; scope: string; passed: number; failed: number; error: string | null };

/** Test ids: "file|describe > test". */
export const testId = (file: string, name: string) => `${file}|${name}`;

type Saved = { results: Record<string, TestResult>; files: Record<string, string | null>; lastRun: TestRun | null };

const state = globalThis as unknown as { __testsRunning?: boolean };
export const testsRunning = () => !!state.__testsRunning;

async function paths() {
  const { join } = await import("node:path");
  const root = process.cwd();
  const dir = join(root, ".test-runs");
  return { root, dir, saved: join(dir, "results.json"), out: join(dir, "last-run.json"), vitest: join(root, "node_modules", "vitest", "vitest.mjs") };
}

/** Run vitest with these arguments, as `npm test` would but without the app's secrets. */
async function vitest(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const { execFile } = await import("node:child_process");
  const p = await paths();
  // Only the shell's basics, as when running `npm test` from a terminal: none of the app's settings
  // (its database address, keys, BANDCAMP_API=off), which the tests set up for themselves. They use
  // their own in-memory databases, so nothing they do reaches real data or services.
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const k of ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "TZ"]) if (process.env[k]) env[k] = process.env[k];
  return new Promise((resolve) => {
    execFile(process.execPath, [p.vitest, ...args], { cwd: p.root, env, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000 }, (err, stdout, stderr) =>
      resolve({ stdout, stderr, code: err ? ((err as { code?: number }).code ?? 1) : 0 }),
    );
  });
}

const relative = (root: string, file: string) => (file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file);

/** Every test, by file (relative to the project), as vitest finds them now. */
export async function listTests(): Promise<TestFile[]> {
  const p = await paths();
  const { stdout, stderr } = await vitest(["list", "--json"]);
  let rows: { name: string; file: string }[] = [];
  try {
    rows = JSON.parse(stdout);
  } catch {
    return [{ file: "(vitest)", tests: [], error: (stderr || stdout).slice(0, 4000) || "Couldn’t list the tests." }];
  }
  const byFile = new Map<string, string[]>();
  for (const r of rows) {
    const f = relative(p.root, r.file);
    byFile.set(f, [...(byFile.get(f) ?? []), r.name]);
  }
  return [...byFile].map(([file, tests]) => ({ file, tests, error: null })).sort((a, b) => a.file.localeCompare(b.file));
}

/** What the last runs found: each test's latest result, files that failed to load, and the latest run. */
export async function savedResults(): Promise<Saved> {
  const { readFile } = await import("node:fs/promises");
  try {
    return JSON.parse(await readFile((await paths()).saved, "utf8")) as Saved;
  } catch {
    return { results: {}, files: {}, lastRun: null };
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Run every test, one file's, or one test (by its "describe > test" name), and keep the results.
 * One run at a time.
 */
export async function runTests(scope: { file?: string; name?: string } = {}): Promise<TestRun> {
  if (state.__testsRunning) throw new Error("Tests are already running.");
  state.__testsRunning = true;
  const started = Date.now();
  try {
    const p = await paths();
    const { mkdir, readFile, writeFile } = await import("node:fs/promises");
    await mkdir(p.dir, { recursive: true });
    const args = ["run", "--reporter=json", `--outputFile=${p.out}`];
    if (scope.file) args.push(scope.file);
    // vitest matches a test by its describe blocks and title joined with spaces.
    if (scope.name) args.push("-t", `^${escapeRegex(scope.name.split(" > ").join(" "))}$`);
    const { stderr } = await vitest(args);

    type Report = {
      testResults: {
        name: string;
        status: string;
        message: string;
        assertionResults: { ancestorTitles: string[]; title: string; status: string; duration: number | null; failureMessages: string[] }[];
      }[];
    };
    let report: Report | null = null;
    try {
      report = JSON.parse(await readFile(p.out, "utf8")) as Report;
    } catch {
      report = null;
    }
    const saved = await savedResults();
    const at = new Date().toISOString();
    let passed = 0;
    let failed = 0;
    for (const f of report?.testResults ?? []) {
      const file = relative(p.root, f.name);
      // A file that failed before any test ran (an import error, say).
      saved.files[file] = f.status === "failed" && !f.assertionResults.some((a) => a.status === "failed") ? f.message || "Failed to run." : null;
      for (const a of f.assertionResults) {
        if (a.status !== "passed" && a.status !== "failed") continue;
        if (a.status === "passed") passed++;
        else failed++;
        saved.results[testId(file, [...a.ancestorTitles, a.title].join(" > "))] = {
          status: a.status,
          ms: Math.round(a.duration ?? 0),
          // (Without terminal colours.)
          failure: a.failureMessages.join("\n\n").replace(/\x1b\[[0-9;]*m/g, "").slice(0, 8000) || null,
          at,
        };
      }
    }
    const run: TestRun = {
      at,
      ms: Date.now() - started,
      scope: scope.name ?? scope.file ?? "all",
      passed,
      failed,
      error: report ? null : stderr.slice(-4000) || "vitest didn’t report any results.",
    };
    saved.lastRun = run;
    await writeFile(p.saved, JSON.stringify(saved));
    return run;
  } finally {
    state.__testsRunning = false;
  }
}
