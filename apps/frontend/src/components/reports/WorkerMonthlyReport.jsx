import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as api from "../../api/client";
import { Button } from "../ui";
import {
  calendarMonths,
  createRequestGate,
  filterError,
  filterKey,
  kgLabel,
  monthlySearch,
  readMonthlyFilters,
} from "./workerMonthlyReportState";

const control = "w-full min-w-0 rounded-md border bg-background p-2 text-sm";
const cell = "p-3 text-left align-top border-b break-words";
function Quality({ quality: q }) {
  return (
    <div className="min-w-0 break-words">
      <strong>{q.item.label}</strong>
      <div className="text-sm text-muted-foreground">
        Side: {q.side} · Yarn: {q.yarn.label} · Cut: {q.cut.label} · Twist:{" "}
        {q.twist.label} · Cone: {q.coneType.label} · Target:{" "}
        {q.targetSizeGrams == null ? "Unrecorded" : `${q.targetSizeGrams} g`}
      </div>
    </div>
  );
}
function Totals({ value }) {
  return (
    <span>
      {value.cones} cones
      {!value.conesComplete &&
        ` known subtotal (${value.unknownConeRows} unknown)`}{" "}
      · {kgLabel(value)}
    </span>
  );
}
function Statement({ statement: s, report }) {
  const daily = new Map(s.dailyTotals.map((day) => [day.date, day.totals]));
  const visibleDates = s.rows.reduce(
    (counts, row) => counts.set(row.date, (counts.get(row.date) || 0) + 1),
    new Map(),
  );
  return (
    <article
      className="rounded-lg border bg-card p-4 sm:p-6 space-y-5 min-w-0"
      aria-label={`Statement for ${s.worker.name} ${s.worker.reference}`}
    >
      <header className="break-words">
        <p className="text-sm font-semibold">GLINTEX</p>
        <h3 className="text-xl font-bold">Coning — Monthly Work Statement</h3>
        <p className="font-semibold mt-2">{s.worker.name}</p>
        <p className="text-sm">Worker reference: {s.worker.reference}</p>
        <p>
          {report.month} · Coning
          {report.period.monthToDate
            ? ` · Month to date · Cutoff ${report.period.cutoff}`
            : ""}
        </p>
        <p className="text-sm text-muted-foreground">
          Generated: {report.generatedAt}
        </p>
      </header>
      <div className="rounded-md bg-muted p-3 font-semibold">
        Monthly total: <Totals value={s.monthlyTotals} />
      </div>
      <section>
        <h4 className="font-semibold mb-2">Monthly quality summary</h4>
        <div className="space-y-2">
          {s.qualitySummary.map((group) => (
            <div key={group.key} className="border rounded-md p-3 space-y-2">
              <Quality quality={group.quality} />
              <p className="text-sm font-semibold">
                <Totals value={group.totals} />
              </p>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h4 className="font-semibold">Date-wise ledger</h4>
        <p className="text-sm text-muted-foreground mb-2">
          {s.rows.length} of {s.totalRows} rows on this page. Daily and monthly
          totals below include all recorded work.
        </p>
        <p className="sm:hidden text-xs text-muted-foreground mb-2">
          Swipe the ledger sideways to see machine, cones and net kg.
        </p>
        {s.rows.length ? (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            aria-label="Work ledger"
          >
            <table className="w-full text-sm table-fixed min-w-[560px]">
              <thead>
                <tr>
                  <th className={`${cell} w-28`}>Work date</th>
                  <th className={cell}>Quality details</th>
                  <th className={`${cell} w-24`}>Machine</th>
                  <th className={`${cell} w-20`}>Cones</th>
                  <th className={`${cell} w-24`}>Net kg</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((row, i) => (
                  <React.Fragment key={i}>
                    <tr>
                      <td className={cell}>{row.date}</td>
                      <td className={cell}>
                        <Quality quality={row.quality} />
                      </td>
                      <td className={cell}>{row.machine.name}</td>
                      <td className={cell}>{row.cones}</td>
                      <td className={cell}>
                        {row.netKg == null ? "Unknown" : row.netKg.toFixed(3)}
                      </td>
                    </tr>
                    {s.rows[i + 1]?.date !== row.date && (
                      <tr className="bg-muted/50">
                        <td className={cell} colSpan={5}>
                          <div className="flex flex-wrap justify-between gap-2 font-semibold">
                            <span>
                              {row.date} · Daily subtotal
                              {visibleDates.get(row.date) !==
                              daily.get(row.date).rowCount
                                ? ` (full date; ${visibleDates.get(row.date)} of ${daily.get(row.date).rowCount} rows on this page)`
                                : ""}
                            </span>
                            <Totals value={daily.get(row.date)} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm">
            This worker’s ledger rows are on another page.
          </p>
        )}
      </section>
      <section>
        <h4 className="font-semibold mb-2">
          Daily subtotals · all work-recorded dates
        </h4>
        <div className="divide-y">
          {s.dailyTotals.map((day) => (
            <div
              key={day.date}
              className="py-2 flex flex-wrap justify-between gap-2 text-sm"
            >
              <span>{day.date}</span>
              <Totals value={day.totals} />
            </div>
          ))}
        </div>
        <p className="border-t pt-3 font-semibold">
          Monthly total: <Totals value={s.monthlyTotals} />
        </p>
      </section>
    </article>
  );
}
function OfficeRows({ title, rows }) {
  return (
    <section className="mt-3">
      <h5 className="font-semibold">
        {title} ({rows.length})
      </h5>
      {rows.length === 0 ? (
        <p>None.</p>
      ) : (
        rows.map((row, i) => (
          <details
            key={`${row.receiveRowId}-${i}`}
            className="border rounded p-2 mt-2 break-words"
          >
            <summary className="cursor-pointer">
              {row.date || "Unassigned period"} · {row.receiveRowId} ·{" "}
              {(row.reasons || row.flags || []).join(", ") ||
                "Detailed references"}
            </summary>
            <pre className="whitespace-pre-wrap break-all text-xs mt-2">
              {JSON.stringify(row, null, 2)}
            </pre>
          </details>
        ))
      )}
    </section>
  );
}
export function WorkerMonthlyReport() {
  const location = useLocation();
  const navigate = useNavigate();
  const filters = readMonthlyFilters(location.search);
  const key = filterKey(filters);
  const error = filterError(filters);
  const gate = useRef(createRequestGate());
  const workersGate = useRef(createRequestGate());
  const activeKey = useRef(key);
  const controller = useRef(null);
  const [workers, setWorkers] = useState({ status: "idle", rows: [] });
  const [view, setView] = useState({ status: "idle" });
  const [download, setDownload] = useState(null);
  const [office, setOffice] = useState(null);
  if (activeKey.current !== key) {
    activeKey.current = key;
    gate.current.invalidate();
    controller.current?.abort();
    setView({ status: "idle" });
    setDownload(null);
    setOffice(null);
  }
  const currentView = view.key === key ? view : { status: "idle" };
  const report = currentView.report;
  useEffect(() => {
    const token = workersGate.current.start();
    const abort = new AbortController();
    setWorkers({ status: error ? "idle" : "loading", rows: [] });
    if (!error)
      api
        .getWorkerMonthlyReport(
          "workers",
          { month: filters.month, process: filters.process, workerId: "all" },
          { signal: abort.signal },
        )
        .then((data) => {
          if (workersGate.current.current(token))
            setWorkers({ status: "ready", rows: data.workers });
        })
        .catch((err) => {
          if (!abort.signal.aborted && workersGate.current.current(token))
            setWorkers({ status: "failed", rows: [], error: err.message });
        });
    return () => {
      abort.abort();
      workersGate.current.invalidate();
    };
  }, [filters.month, filters.process, error]);
  useEffect(
    () => () => {
      gate.current.invalidate();
      controller.current?.abort();
    },
    [],
  );
  function change(patch) {
    gate.current.invalidate();
    controller.current?.abort();
    setView({ status: "idle" });
    setDownload(null);
    setOffice(null);
    navigate({
      search: monthlySearch(location.search, { ...filters, ...patch }),
    });
  }
  async function load(page = 1) {
    controller.current?.abort();
    controller.current = new AbortController();
    const token = gate.current.start();
    setView({ status: "loading", key });
    setOffice(null);
    setDownload(null);
    try {
      const data = await api.getWorkerMonthlyReport("preview", filters, {
        page,
        signal: controller.current.signal,
      });
      if (gate.current.current(token))
        setView({
          status: data.totalRows ? "ready" : "empty",
          report: data,
          key,
        });
    } catch (err) {
      if (gate.current.current(token))
        setView({ status: "failed", error: err.message, key });
    }
  }
  async function save(format) {
    const token = gate.current.start();
    controller.current?.abort();
    controller.current = new AbortController();
    setDownload({ key, status: "loading" });
    try {
      const result = await api.downloadWorkerMonthlyReport(format, filters, {
        signal: controller.current.signal,
      });
      if (!gate.current.current(token)) return;
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setDownload({
        key,
        status: "ready",
        message: `Download generated: ${result.generatedAt || "See file header"}. Refresh the preview to compare this generation; later edits may change totals.`,
      });
    } catch (err) {
      if (gate.current.current(token))
        setDownload({ key, status: "failed", message: err.message });
    }
  }
  async function loadOffice() {
    const token = gate.current.start();
    controller.current?.abort();
    controller.current = new AbortController();
    setOffice({ key, status: "loading" });
    try {
      const [exceptions, details] = await Promise.all(
        ["exceptions", "details"].map((endpoint) =>
          api.getWorkerMonthlyReport(endpoint, filters, {
            page: report.page,
            signal: controller.current.signal,
          }),
        ),
      );
      if (gate.current.current(token))
        setOffice({ key, status: "ready", exceptions, details });
    } catch (err) {
      if (gate.current.current(token))
        setOffice({ key, status: "failed", error: err.message });
    }
  }
  const busy =
    currentView.status === "loading" ||
    (download?.key === key && download.status === "loading") ||
    (office?.key === key && office.status === "loading");
  return (
    <div className="space-y-5 min-w-0">
      <section className="rounded-lg border bg-card p-4 space-y-4">
        <h2 className="text-lg font-semibold">Worker Monthly Report</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <label className="text-sm font-medium">
            Month and year
            <input
              aria-label="Month and year"
              type="month"
              min="0001-01"
              max={calendarMonths().current}
              className={`${control} mt-1`}
              value={filters.month}
              onChange={(event) =>
                change({ month: event.target.value, workerId: "all" })
              }
            />
          </label>
          <label className="text-sm font-medium">
            Process
            <select
              className={`${control} mt-1`}
              value={filters.process}
              onChange={(event) => change({ process: event.target.value })}
            >
              {filters.process !== "coning" && (
                <option value={filters.process}>
                  Unsupported: {filters.process}
                </option>
              )}
              <option value="coning">Coning</option>
              <option value="cutter" disabled>
                Cutter · Coming soon
              </option>
              <option value="holo" disabled>
                Holo · Coming soon
              </option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Worker
            <select
              className={`${control} mt-1`}
              value={filters.workerId}
              disabled={workers.status === "loading" || !!error}
              onChange={(event) => change({ workerId: event.target.value })}
            >
              <option value="all">All Workers</option>
              {!workers.rows.some((worker) => worker.id === filters.workerId) &&
                filters.workerId !== "all" && (
                  <option value={filters.workerId}>
                    Selected reference: {filters.workerId}
                  </option>
                )}
              {workers.rows.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.name} · {worker.reference}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Historical receive workers, including previous process assignments.
          Only dates with work recorded appear.
        </p>
        {workers.status === "loading" && (
          <p role="status">Loading historical workers…</p>
        )}
        {workers.status === "failed" && (
          <p role="alert">
            Worker list failed: {workers.error} Preview may be retried for the
            selected reference.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => load()} disabled={!!error || busy}>
            Load preview
          </Button>
          <Button
            variant="outline"
            onClick={() => save("pdf")}
            disabled={currentView.status !== "ready" || busy}
          >
            Download PDF{filters.workerId === "all" ? " ZIP" : ""}
          </Button>
          <Button
            variant="outline"
            onClick={() => save("xlsx")}
            disabled={currentView.status !== "ready" || busy}
          >
            Download Excel{filters.workerId === "all" ? " ZIP" : ""}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          All Workers downloads contain separate private files. Excel includes
          office references; review before sharing. Each request is a new
          generation; later source edits can change regenerated statements.
        </p>
      </section>
      <div aria-live="polite">
        {currentView.status === "idle" && !error && (
          <p>
            Select filters and load a preview. Previous results are invalidated
            when filters change.
          </p>
        )}
        {currentView.status === "loading" && (
          <p role="status">Loading statement preview…</p>
        )}
        {currentView.status === "failed" && (
          <p role="alert">
            Report failed: {currentView.error} No work totals are available.
            Retry Load preview.
          </p>
        )}
        {currentView.status === "empty" && (
          <p>
            No qualifying work recorded for this selection. Review office
            exceptions below.
          </p>
        )}
        {download?.key === key && (
          <p role={download.status === "failed" ? "alert" : "status"}>
            {download.status === "loading"
              ? "Generating download…"
              : download.message}
          </p>
        )}
      </div>
      {report && (
        <>
          {report.period.monthToDate && (
            <p className="rounded-md bg-muted p-3">
              Month to date · Effective cutoff: {report.period.cutoff} (
              {report.period.timeZone})
            </p>
          )}
          {report.statements.map((statement) => (
            <Statement
              key={statement.worker.id}
              statement={statement}
              report={report}
            />
          ))}
          {report.totalRows > report.pageSize && (
            <nav
              aria-label="Ledger pages"
              className="flex flex-wrap gap-3 items-center"
            >
              <Button
                variant="outline"
                disabled={report.page <= 1 || busy}
                onClick={() => load(report.page - 1)}
              >
                Previous ledger page
              </Button>
              <span>
                Page {report.page} of{" "}
                {Math.ceil(report.totalRows / report.pageSize)} ·{" "}
                {report.totalRows} rows
              </span>
              <Button
                variant="outline"
                disabled={
                  report.page * report.pageSize >= report.totalRows || busy
                }
                onClick={() => load(report.page + 1)}
              >
                Next ledger page
              </Button>
              <p className="text-xs w-full">
                Changing pages refreshes this report. Totals and downloads
                always include the full selection.
              </p>
            </nav>
          )}
          <section
            className="border rounded-lg p-4 space-y-3"
            aria-label="Office reconciliation"
          >
            <h3 className="font-semibold">Office reconciliation</h3>
            <p className="text-sm">
              Office use only. Exceptions and excluded stock are separate from
              worker statement totals; unassigned-period records do not belong
              to this month.
            </p>
            <p>
              Selected eligible work:{" "}
              <Totals value={report.office.selectedTotals} />
            </p>
            <p>
              All eligible workers: <Totals value={report.office.totals} />
            </p>
            <p>
              Selected-month source accounting (eligible + exceptions +
              excluded):{" "}
              <Totals value={report.office.reconciliation.periodAccounted} />
            </p>
            <p className="text-sm">
              {report.office.exceptionCount} month exceptions ·{" "}
              {report.office.unassignedPeriodExceptionCount} unassigned-period
              exceptions · {report.office.excludedCount} excluded rows
            </p>
            <Button variant="outline" disabled={busy} onClick={loadOffice}>
              Load office diagnostics and references
            </Button>
            {office?.key === key &&
              (office.status === "loading" ? (
                <p role="status">Loading office records…</p>
              ) : office.status === "failed" ? (
                <p role="alert">Office records failed: {office.error}</p>
              ) : (
                <div className="text-sm">
                  <p>
                    References generated {office.details.generatedAt};
                    exceptions generated {office.exceptions.generatedAt}.
                    Separate reads may reflect later edits. References use
                    independent chronological pagination, page{" "}
                    {office.details.page} of{" "}
                    {Math.max(
                      1,
                      Math.ceil(
                        office.details.totalRows / office.details.pageSize,
                      ),
                    )}
                    .
                  </p>
                  <OfficeRows
                    title="Selected-worker detailed references (office page)"
                    rows={office.details.rows}
                  />
                  <OfficeRows
                    title="Month exceptions (all workers)"
                    rows={office.exceptions.exceptions}
                  />
                  <p>
                    Exception totals:{" "}
                    <Totals value={office.exceptions.exceptionTotals} />
                  </p>
                  <OfficeRows
                    title="Unassigned-period exceptions"
                    rows={office.exceptions.unassignedPeriodExceptions}
                  />
                  <OfficeRows
                    title="Excluded stock (all workers)"
                    rows={office.exceptions.excluded}
                  />
                  <p>
                    Excluded totals:{" "}
                    <Totals value={office.exceptions.excludedTotals} />
                  </p>
                </div>
              ))}
          </section>
        </>
      )}
    </div>
  );
}
