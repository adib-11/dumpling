import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { problemReportUrl, systemName } from "../src/report-problem"

test("Report a problem opens a new issue on the bug report form, filled in", () => {
  const url = new URL(
    problemReportUrl({
      version: "0.2.0",
      system: "macOS 15.2 arm64",
      lastError: { when: "2026-10-23T12:00:00.000Z", reason: "runner exited 3" },
    }),
  )

  assert.equal(`${url.origin}${url.pathname}`, "https://github.com/adib-11/dumpling/issues/new")
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    template: "bug_report.yml",
    version: "0.2.0",
    system: "macOS 15.2 arm64",
    "ingest-error": "2026-10-23T12:00:00.000Z runner exited 3",
  })
})

test("with no failed Ingest the report says so", () => {
  const url = new URL(problemReportUrl({ version: "0.2.0", system: "Linux 6.8.0 x64", lastError: null }))
  assert.equal(url.searchParams.get("ingest-error"), "None")
})

test("the report names no folder, and a long error is cut short", () => {
  const folder = path.join("/Users/ada", "Documents", "Dumpling")
  const url = new URL(
    problemReportUrl({
      version: "0.2.0",
      system: "macOS 15.2 arm64",
      lastError: { when: "2026-10-23T12:00:00.000Z", reason: `index.md failed: EACCES ${folder}/vault/wiki/x.md ${"y".repeat(2000)}` },
      folder,
      home: "/Users/ada",
    }),
  )
  const error = url.searchParams.get("ingest-error") ?? ""
  assert.match(error, /^2026-10-23T12:00:00\.000Z index\.md failed: EACCES <folder>\/vault\/wiki\/x\.md y+…$/)
  assert.equal(error.includes("/Users/ada"), false)
  assert.ok(error.length <= 500, String(error.length))
})

test("the system is named the way the Owner knows it", () => {
  assert.equal(systemName("darwin", "15.2", "arm64"), "macOS 15.2 arm64")
  assert.equal(systemName("win32", "10.0.26100", "x64"), "Windows 10.0.26100 x64")
  assert.equal(systemName("linux", "6.8.0-45-generic", "x64"), "Linux 6.8.0-45-generic x64")
})

test("the bug report form has a field for each value the app fills in", () => {
  const form = fs.readFileSync(path.join(__dirname, "..", ".github", "ISSUE_TEMPLATE", "bug_report.yml"), "utf8")
  for (const id of ["version", "system", "ingest-error", "what-happened"]) {
    assert.match(form, new RegExp(`^\\s+id: ${id}$`, "m"), id)
  }
})
