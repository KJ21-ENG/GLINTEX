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
  const calendar = s.calendar;
  const weight = (total) => !total ? "-" : total.unknownWeightRows === total.rowCount ? "?" : `${total.netKg.toFixed(3)}${total.weightComplete ? "" : "*"}`;
  const cones = (total) => !total ? "-" : `${total.cones}${total.conesComplete ? "" : "*"}`;
  const cell = "border px-3 py-1.5 text-right tabular-nums whitespace-nowrap";
  return (
    <article className="rounded-lg border bg-card p-4 sm:p-6 space-y-4 min-w-0" aria-label={`Statement for ${s.worker.name} ${s.worker.reference}`}>
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-muted-foreground">GLINTEX · CONING</p>
          <h3 className="text-2xl font-bold mt-1">{s.worker.name}</h3>
          <p className="text-sm text-muted-foreground">Monthly work report · {report.month}</p>
        </div>
        <div className="text-sm sm:text-right">
          <p className="font-semibold">{calendar.workedDays} days with work recorded</p>
          <p><Totals value={s.monthlyTotals} /></p>
        </div>
      </header>
      <p className="text-sm text-muted-foreground">Yarn columns show weight in kg. A dash (-) means no work recorded.</p>
      <div className="overflow-x-auto" tabIndex={0} aria-label="Monthly work calendar">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-muted">
            <tr>
              <th className="border px-3 py-2 text-left min-w-20 sticky left-0 bg-muted">Date</th>
              {calendar.columns.map(column => <th key={column.key} className="border px-3 py-2 text-center min-w-28 max-w-56 break-words">{column.label}<span className="block text-xs font-normal text-muted-foreground">kg</span></th>)}
              <th className="border px-3 py-2 min-w-24">Total cones</th>
              <th className="border px-3 py-2 min-w-24">Total kg</th>
            </tr>
          </thead>
          <tbody>
            {calendar.days.map(day => <tr key={day.date} className={day.totals ? "" : "bg-muted/20 text-muted-foreground"}>
              <th scope="row" className="border px-3 py-1.5 text-left font-normal whitespace-nowrap sticky left-0 bg-card">{day.date.split('-').reverse().join('/')}</th>
              {day.cells.map((total, index) => <td key={calendar.columns[index].key} className={cell}>{weight(total)}</td>)}
              <td className={cell}>{cones(day.totals)}</td>
              <td className={`${cell} font-medium`}>{weight(day.totals)}</td>
            </tr>)}
          </tbody>
          <tfoot className="bg-muted font-semibold"><tr>
            <th className="border px-3 py-2 text-left">Total</th>
            {calendar.columns.map(column => <td key={column.key} className={cell}>{weight(column.totals)}</td>)}
            <td className={cell}>{cones(calendar.totals)}</td><td className={cell}>{weight(calendar.totals)}</td>
          </tr></tfoot>
        </table>
      </div>
      <section aria-label="Yarn-wise total weight">
        <h4 className="font-semibold mb-2">Yarn-wise total weight</h4>
        <div className="grid sm:grid-cols-2 gap-x-6">
          {calendar.columns.map(column => <div key={column.key} className="flex justify-between gap-4 border-b py-2 text-sm"><span>{column.label}</span><strong className="whitespace-nowrap tabular-nums">{weight(column.totals)} kg</strong></div>)}
        </div>
      </section>
      {(!calendar.totals.weightComplete || !calendar.totals.conesComplete) && <p className="text-xs">? = quantity not recorded. * = total includes known quantities only.</p>}
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
  async function loadOffice(page = 1) {
    const token = gate.current.start();
    controller.current?.abort();
    controller.current = new AbortController();
    setOffice({ key, status: "loading" });
    try {
      const [exceptions, details] = await Promise.all(
        ["exceptions", "details"].map((endpoint) =>
          api.getWorkerMonthlyReport(endpoint, filters, {
            page,
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
                    Selected worker
                  </option>
                )}
              {workers.rows.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          One calendar for each worker, with every date of the month.
          Only yarns handled by that worker appear as columns.
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
          <details
            className="border rounded-lg p-4 space-y-3"
            aria-label="Office reconciliation"
          >
            <summary className="font-semibold cursor-pointer">Office reconciliation</summary>
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
            <Button variant="outline" disabled={busy} onClick={() => loadOffice()}>
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
                  <nav aria-label="Office reference pages" className="flex gap-2 my-3">
                    <Button variant="outline" disabled={busy || office.details.page <= 1} onClick={() => loadOffice(office.details.page - 1)}>Previous references</Button>
                    <Button variant="outline" disabled={busy || office.details.page * office.details.pageSize >= office.details.totalRows} onClick={() => loadOffice(office.details.page + 1)}>Next references</Button>
                  </nav>
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
          </details>
        </>
      )}
    </div>
  );
}
