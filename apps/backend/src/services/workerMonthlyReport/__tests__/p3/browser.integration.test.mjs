// Explicitly run against browserHarness.mjs. Fresh profile, loopback fixture only.
// P3 Main approved isolated Playwright validation after CUA canceled blob saves.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const { chromium } = await import(process.env.P3_PLAYWRIGHT || "playwright");
const base = "http://127.0.0.1:5187";
const apiBase = "http://127.0.0.1:5188";
const output =
  process.env.P3_BROWSER_OUTPUT ||
  "/Volumes/MacSSD/tmp/glintex-p3-browser-automated";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test(
  "real Reports page: filters, stale requests, permissions, private files, and narrow mobile",
  { timeout: 120000 },
  async (t) => {
    await mkdir(output, { recursive: true });
    const profile = await mkdtemp(
      path.join(tmpdir(), "glintex-p3-playwright-"),
    );
    const context = await chromium.launchPersistentContext(profile, {
      headless: true,
      executablePath:
        process.env.P3_CHROME ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      viewport: { width: 1280, height: 900 },
      acceptDownloads: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2026-09-07T00:00:00Z"));
    page.setDefaultTimeout(7000);
    const errors = [];
    const downloads = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("download", (item) => downloads.push(item));
    const checks = [];
    const record = (name, details) => checks.push({ name, details });
    const snapshot = async (name) => {
      await writeFile(
        `${output}/${name}.txt`,
        await page.locator("body").innerText(),
      );
      await page.screenshot({ path: `${output}/${name}.png`, fullPage: false });
    };
    const preview = async () => {
      const response = page.waitForResponse((res) =>
        res.url().includes("/preview?"),
      );
      await page
        .getByRole("button", { name: "Load preview", exact: true })
        .click();
      const data = await (await response).json();
      await page
        .getByRole("button", { name: "Load preview", exact: true })
        .waitFor({ state: "visible" });
      if (data.totalRows) await page.getByRole("article").first().waitFor();
      return data;
    };
    try {
      await t.test(
        "desktop default, actual normalized preview, office references and full pagination",
        async () => {
          await page.goto(`${base}/?reportTab=worker-monthly&unrelated=kept`);
          assert.equal(
            await page
              .getByRole("textbox", { name: "Month and year" })
              .inputValue(),
            "2026-08",
          );
          await page
            .getByRole("combobox", { name: "Worker", exact: true })
            .selectOption("all");
          assert.equal(
            await page
              .getByRole("option", { name: "Cutter · Coming soon" })
              .getAttribute("disabled"),
            "",
          );
          assert.equal(
            await page
              .getByRole("option", { name: "Holo · Coming soon" })
              .getAttribute("disabled"),
            "",
          );
          const data = await preview();
          assert.equal(data.totalRows, 126);
          assert.equal(await page.getByRole("article").count(), 2);
          assert.equal(data.statements[0].monthlyTotals.cones, 630);
          assert.equal(data.statements[0].monthlyTotals.netGrams, 76570);
          assert.equal(data.statements[0].monthlyTotals.weightComplete, false);
          assert.equal(
            data.statements[0].dailyTotals.reduce(
              (sum, x) => sum + x.totals.netGrams,
              0,
            ),
            76570,
          );
          await writeFile(
            `${output}/normalized-preview.json`,
            JSON.stringify(data, null, 2),
          );
          assert.match(
            await page.getByRole("article").first().innerText(),
            /76\.570 kg known subtotal \(incomplete; 1 unknown\)/,
          );
          await snapshot("desktop-preview");
          await page
            .getByRole("button", {
              name: "Load office diagnostics and references",
            })
            .click();
          await page
            .getByRole("heading", {
              name: "Month exceptions (all workers) (1)",
              exact: true,
            })
            .waitFor();
          await page
            .getByText("2026-08-15 · missing-worker · missing_worker", {
              exact: true,
            })
            .click();
          assert.match(
            await page
              .getByRole("region", { name: "Office reconciliation" })
              .innerText(),
            /"receiveRowId": "missing-worker"/,
          );
          await snapshot("office-expanded");
          await page.getByText("2026-08-01 · fixture-000 · unknown_net_weight", { exact: true }).click();
          const references = await page.getByRole("region", { name: "Office reconciliation" }).innerText();
          assert.match(references, /"provenance"/);
          assert.match(references, /"receiveBarcode": "CR-1"/);
          await snapshot("office-references");
          await page.getByRole("button", { name: "Next ledger page" }).click();
          await page
            .getByText("Page 2 of 2 · 126 rows", { exact: true })
            .waitFor();
          assert.equal(await page.getByRole("article").count(), 2);
          assert.match(
            await page.getByRole("article").first().innerText(),
            /630 cones · 76\.570 kg known subtotal/,
          );
          await snapshot("page-two");
          record("desktop", {
            rows: 126,
            workers: 2,
            fullTotalsAcrossPages: true,
          });
        },
      );
      await t.test(
        "cross-origin credentialed all-worker and single-worker PDF/Excel preserve filename and generation",
        async () => {
          for (const selection of ["all", "worker/0"]) {
            if (selection !== "all") {
              await page
                .getByRole("combobox", { name: "Worker", exact: true })
                .selectOption(selection);
              assert.equal(await page.getByRole("article").count(), 0);
              assert.equal(
                await page
                  .getByRole("button", { name: "Download PDF", exact: true })
                  .isDisabled(),
                true,
              );
              await preview();
              assert.equal(await page.getByRole("article").count(), 1);
            }
            for (const [format, label] of [
              ["pdf", "PDF"],
              ["xlsx", "Excel"],
            ]) {
              assert.notEqual(new URL(page.url()).origin, apiBase);
              const responseWaiting = page.waitForResponse(res => res.url().startsWith(`${apiBase}/api/reports/worker-monthly/download/${format}?`));
              const waiting = page.waitForEvent("download");
              await page
                .getByRole("button", {
                  name: `Download ${label}${selection === "all" ? " ZIP" : ""}`,
                  exact: true,
                })
                .click();
              const download = await waiting;
              const response = await responseWaiting;
              assert.equal(response.status(), 200);
              const requestHeaders = await response.request().allHeaders();
              assert.match(requestHeaders.cookie, /glintex_session=synthetic-local-fixture/);
              assert.equal(response.headers()["access-control-allow-origin"], base);
              assert.equal(response.headers()["access-control-allow-credentials"], "true");
              const expectedName = selection === "all"
                ? `coning-2026-08-all-workers-${format}.zip`
                : `coning-2026-08-Same-Worker-worker-0-${createHash("sha256").update(selection).digest("hex")}.${format}`;
              assert.equal(download.suggestedFilename(), expectedName);
              assert.equal(response.headers()["access-control-expose-headers"], "Content-Disposition, X-Report-Generated-At");
              assert.equal(await download.failure(), null);
              const filename =
                selection === "all" ? `all-${format}.zip` : `worker.${format}`;
              await download.saveAs(`${output}/${filename}`);
              const bytes = await readFile(`${output}/${filename}`);
              assert.ok(bytes.length > 1000);
              assert.equal(
                bytes
                  .subarray(0, selection !== "all" && format === "pdf" ? 4 : 2)
                  .toString(),
                selection !== "all" && format === "pdf" ? "%PDF" : "PK",
              );
              await page
                .getByRole("status")
                .filter({ hasText: "Download generated: 2026-09-07T00:00:00.000Z." })
                .waitFor();
              record("saved-file", {
                selection,
                format,
                filename,
                suggested: download.suggestedFilename(),
                apiOrigin: apiBase,
                uiOrigin: base,
                credentialCookieVerified: true,
                generation: "2026-09-07T00:00:00.000Z",
                bytes: bytes.length,
              });
            }
          }
          await snapshot("single-worker-download");
        },
      );
      await t.test(
        "pending preview and pending download are invalidated before late responses",
        async () => {
          for (const endpoint of ["preview", "download/pdf"]) {
            const entered = deferred(),
              release = deferred(),
              finished = deferred();
            const pattern = `**/api/reports/worker-monthly/${endpoint}?*`;
            await page.route(pattern, async (route) => {
              try {
                const response = await route.fetch();
                entered.resolve();
                await release.promise;
                await route.fulfill({ response });
              } catch {
              } finally {
                finished.resolve();
              }
            });
            if (endpoint === "download/pdf") await preview();
            const count = downloads.length;
            await page
              .getByRole("button", {
                name: endpoint === "preview" ? "Load preview" : "Download PDF",
                exact: true,
              })
              .click();
            await entered.promise;
            assert.match(
              await page.locator("body").innerText(),
              endpoint === "preview"
                ? /Loading statement preview/
                : /Generating download/,
            );
            await page
              .getByRole("combobox", { name: "Worker", exact: true })
              .selectOption(endpoint === "preview" ? "worker/1" : "worker/0");
            assert.equal(await page.getByRole("article").count(), 0);
            assert.equal(
              await page
                .getByRole("button", { name: "Download PDF", exact: true })
                .isDisabled(),
              true,
            );
            release.resolve();
            await finished.promise;
            await page.unroute(pattern);
            await page
              .getByText("Select filters and load a preview.", { exact: false })
              .waitFor();
            assert.equal(await page.getByRole("article").count(), 0);
            assert.equal(downloads.length, count);
            await snapshot(
              endpoint === "preview" ? "stale-preview" : "stale-download",
            );
            record("stale-response", {
              endpoint,
              noObsoletePreviewOrDownload: true,
            });
          }
        },
      );
      await t.test(
        "empty, failure, unsupported, future, current-month cutoff and address restore",
        async () => {
          await page
            .getByRole("textbox", { name: "Month and year" })
            .fill("2026-07");
          await preview();
          await page
            .getByText("No qualifying work recorded for this selection.", {
              exact: false,
            })
            .waitFor();
          await snapshot("empty");
          await page
            .getByRole("textbox", { name: "Month and year" })
            .fill("2026-06");
          await preview();
          await page
            .getByRole("alert")
            .filter({ hasText: "Report failed:" })
            .waitFor();
          assert.doesNotMatch(
            await page.locator("body").innerText(),
            /No qualifying work recorded/,
          );
          await snapshot("failed");
          await page.goto(
            `${base}/?reportTab=worker-monthly&wmProcess=holo&wmMonth=2026-08`,
          );
          await page
            .getByRole("alert")
            .filter({ hasText: "not supported" })
            .waitFor();
          assert.equal(
            await page
              .getByRole("button", { name: "Load preview", exact: true })
              .isDisabled(),
            true,
          );
          await snapshot("unsupported");
          await page.goto(`${base}/?reportTab=worker-monthly&wmMonth=2027-01`);
          await page
            .getByRole("alert")
            .filter({ hasText: "Future months" })
            .waitFor();
          await snapshot("future");
          await page.goto(`${base}/?reportTab=worker-monthly&wmMonth=2026-09`);
          const current = await preview();
          assert.equal(current.period.monthToDate, true);
          await page
            .getByText(
              `Month to date · Effective cutoff: ${current.period.cutoff} (Asia/Kolkata)`,
              { exact: true },
            )
            .waitFor();
          await snapshot("month-to-date");
          await page.goto(
            `${base}/?reportTab=worker-monthly&wmMonth=2026-08&wmWorker=worker%2F1&unrelated=kept`,
          );
          await preview();
          await page
            .getByRole("combobox", { name: "Worker", exact: true })
            .selectOption("worker/0");
          await page.goBack();
          assert.equal(
            await page
              .getByRole("combobox", { name: "Worker", exact: true })
              .inputValue(),
            "worker/1",
          );
          assert.equal(await page.getByRole("article").count(), 0);
          await page.reload();
          assert.equal(
            await page
              .getByRole("combobox", { name: "Worker", exact: true })
              .inputValue(),
            "worker/1",
          );
          assert.match(page.url(), /unrelated=kept/);
          record("states-and-restore", {
            empty: true,
            failed: true,
            unsupported: true,
            future: true,
            currentCutoff: current.period.cutoff,
            noOldPreviewOnBack: true,
          });
        },
      );
      await t.test(
        "existing tabs retain navigation and mobile scanner route to monthly report",
        async () => {
          await page
            .getByRole("button", { name: "Barcode History", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Trace History", exact: true })
            .waitFor();
          await snapshot("existing-barcode");
          await page
            .getByRole("button", { name: "Production Report", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Daily Export", exact: true })
            .waitFor();
          await page
            .getByRole("button", { name: "Weekly Export", exact: true })
            .waitFor();
          await page
            .getByText("No data available for selected filters", {
              exact: true,
            })
            .waitFor();
          await snapshot("existing-production");
          await page
            .getByRole("button", { name: "Worker Monthly Report", exact: true })
            .click();
          assert.equal(
            await page
              .getByRole("combobox", { name: "Worker", exact: true })
              .inputValue(),
            "worker/1",
          );
          record("existing-tabs", {
            barcode: true,
            production: true,
            monthlyRestored: true,
          });
        },
      );
      await t.test(
        "390px mobile filters, wrapped summary, scrolling ledger, errors and saved file",
        async () => {
          await page.setViewportSize({ width: 390, height: 844 });
          await preview();
          assert.deepEqual(
            await page.evaluate(() => ({
              viewport: innerWidth,
              width: document.documentElement.scrollWidth,
            })),
            { viewport: 390, width: 390 },
          );
          await snapshot("mobile-filters");
          await page
            .getByRole("heading", {
              name: "Monthly quality summary",
              exact: true,
            })
            .scrollIntoViewIfNeeded();
          await snapshot("mobile-quality");
          const ledger = page.getByLabel("Work ledger");
          await ledger.scrollIntoViewIfNeeded();
          assert.ok(
            await ledger.evaluate((el) => el.scrollWidth > el.clientWidth),
          );
          await snapshot("mobile-ledger");
          await ledger.hover();
          await page.mouse.wheel(500, 0);
          await page.waitForFunction(
            () =>
              document.querySelector('[aria-label="Work ledger"]').scrollLeft >
              0,
          );
          await snapshot("mobile-ledger-right");
          const waiting = page.waitForEvent("download");
          await page
            .getByRole("button", { name: "Download PDF", exact: true })
            .click();
          const download = await waiting;
          assert.equal(await download.failure(), null);
          await download.saveAs(`${output}/mobile-worker.pdf`);
          await page
            .getByRole("textbox", { name: "Month and year" })
            .fill("2026-06");
          await preview();
          await page
            .getByRole("alert")
            .filter({ hasText: "Report failed:" })
            .waitFor();
          await snapshot("mobile-failed");
          assert.deepEqual(
            await page.evaluate(() => ({
              viewport: innerWidth,
              width: document.documentElement.scrollWidth,
            })),
            { viewport: 390, width: 390 },
          );
          await page
            .getByRole("button", { name: "Barcode History", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Desktop View", exact: true })
            .waitFor();
          await snapshot("mobile-barcode-scanner");
          await page
            .getByRole("button", { name: "Worker Monthly Report", exact: true })
            .click();
          await page
            .getByRole("heading", {
              name: "Worker Monthly Report",
              exact: true,
            })
            .waitFor();
          record("mobile", {
            scannerNavigation: true,
            width: 390,
            noPageOverflow: true,
            ledgerScroll: true,
            fileSaved: true,
          });
        },
      );
      await t.test(
        "all six endpoints enforce actual authentication and report permission",
        async () => {
          for (const endpoint of [
            "workers",
            "preview",
            "details",
            "exceptions",
            "download/pdf",
            "download/xlsx",
          ])
            for (const [cookie, status] of [
              ["", 401],
              ["glintex_session=p3-denied", 403],
            ]) {
              const res = await fetch(
                `${apiBase}/api/reports/worker-monthly/${endpoint}?month=2026-08`,
                { headers: cookie ? { Cookie: cookie } : {} },
              );
              assert.equal(res.status, status);
            }
          record("authorization", {
            endpoints: 6,
            unauthenticated: 401,
            noReportPermission: 403,
          });
        },
      );
      assert.deepEqual(errors, []);
    } finally {
      await writeFile(
        `${output}/checks.json`,
        JSON.stringify({ profile, checks, errors }, null, 2),
      );
      await writeFile(
        `${output}/last-page.txt`,
        await page
          .locator("body")
          .innerText()
          .catch(() => ""),
      );
      await context.close();
    }
  },
);
