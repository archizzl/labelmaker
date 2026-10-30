import { Badge, Callout, Card, Empty } from "@/components/ui";
import { plural } from "@/lib/plural";
import { runTestsAction } from "@/server/admin-actions";
import { listTests, savedResults, type TestResult, testId, testsRunning } from "@/server/test-runner";
import { RunTestsButton } from "./run-tests-button";

/** "src/server/__tests__/label-join.test.ts" → "server/label-join". */
const short = (file: string) => file.replace(/^src\//, "").replace("/__tests__/", "/").replace(/\.test\.tsx?$/, "");

const seconds = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`);

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A test's latest result, as a mark. */
function Mark({ r }: { r: TestResult | undefined }) {
  if (!r) return <span className="w-4 shrink-0 text-center text-muted">·</span>;
  if (r.status === "passed") return <span className="w-4 shrink-0 text-center text-good">✓</span>;
  if (r.status === "failed") return <span className="w-4 shrink-0 text-center text-bad">✗</span>;
  return <span className="w-4 shrink-0 text-center text-muted">–</span>;
}

/**
 * The admin dashboard's Tests tab (a local copy only): every test by file, how each did last time,
 * and runs of all of them, a file's or one test. A file with a failure opens by itself.
 */
export async function AdminTests() {
  const [files, saved] = await Promise.all([listTests(), savedResults()]);
  const total = files.reduce((a, f) => a + f.tests.length, 0);
  const last = saved.lastRun;
  return (
    <>
      {testsRunning() && <Callout tone="neutral">Tests are running. This page shows their results once they finish.</Callout>}
      <Card
        title={`${plural(total, "test")} in ${plural(files.length, "file")}`}
        actions={
          <form action={runTestsAction}>
            <RunTestsButton variant="primary" size="md">
              Run all
            </RunTestsButton>
          </form>
        }
      >
        {last ? (
          <p className="text-sm">
            Last run ({last.scope === "all" ? "all tests" : short(last.scope)}), {when(last.at)}: <span className="text-good">{last.passed} passed</span>
            {last.failed > 0 && <span className="text-bad">, {last.failed} failed</span>}, in {seconds(last.ms)}.
          </p>
        ) : (
          <p className="text-sm text-muted">Not run yet.</p>
        )}
        {last?.error && <pre className="mt-3 max-h-64 overflow-auto rounded-sm bg-surface-2 p-3 text-xs whitespace-pre-wrap">{last.error}</pre>}
      </Card>

      {files.length === 0 && <Empty>No tests found.</Empty>}
      <div className="divide-y divide-border border-y border-border">
        {files.map((f) => {
          const results = f.tests.map((name) => saved.results[testId(f.file, name)]);
          const failed = results.filter((r) => r?.status === "failed").length;
          const passed = results.filter((r) => r?.status === "passed").length;
          const fileError = f.error ?? saved.files[f.file] ?? null;
          return (
            <details key={f.file} open={failed > 0 || !!fileError} className="group/file">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:bg-surface-2">
                <span className="w-4 shrink-0 text-center text-xs text-muted transition group-open/file:rotate-90">▸</span>
                <span className="font-medium">{short(f.file)}</span>
                <span className="text-xs text-muted">{plural(f.tests.length, "test")}</span>
                {fileError || failed ? (
                  <Badge tone="bad">{fileError ? "didn’t run" : `${failed} failed`}</Badge>
                ) : passed === f.tests.length && passed > 0 ? (
                  <Badge tone="good">passed</Badge>
                ) : passed > 0 ? (
                  <Badge>{passed} passed</Badge>
                ) : null}
                <form action={runTestsAction} className="ml-auto">
                  <input type="hidden" name="file" value={f.file} />
                  <RunTestsButton>Run</RunTestsButton>
                </form>
              </summary>
              <div className="mb-3 ml-7 space-y-1 text-sm">
                {fileError && <pre className="max-h-64 overflow-auto rounded-sm bg-surface-2 p-3 text-xs whitespace-pre-wrap text-bad">{fileError}</pre>}
                {f.tests.map((name, i) => {
                  const r = results[i];
                  return (
                    <div key={name}>
                      <div className="flex items-start gap-2">
                        <Mark r={r} />
                        <span className="min-w-0 flex-1">{name}</span>
                        {r && <span className="text-xs whitespace-nowrap text-muted">{r.ms} ms · {when(r.at)}</span>}
                        <form action={runTestsAction}>
                          <input type="hidden" name="file" value={f.file} />
                          <input type="hidden" name="name" value={name} />
                          <RunTestsButton>Run</RunTestsButton>
                        </form>
                      </div>
                      {r?.failure && <pre className="mt-1 mb-2 ml-6 max-h-72 overflow-auto rounded-sm bg-surface-2 p-3 text-xs whitespace-pre-wrap">{r.failure}</pre>}
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}
