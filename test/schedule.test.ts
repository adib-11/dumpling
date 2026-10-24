import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { claimDailyIngest, readDrain, rememberDrain } from "../src/schedule"

const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0)

test("the daily Ingest is claimed once a day, at the first call after 03:00", () => {
  const stamp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "schedule-")), "daily-ingest")

  assert.equal(claimDailyIngest(stamp, at(22, 23)), true, "first ever")
  assert.equal(claimDailyIngest(stamp, at(23, 1)), false, "before 03:00 the next day")
  // Asleep at 03:00: the next wake runs it, and not again that day.
  assert.equal(claimDailyIngest(stamp, at(23, 8)), true, "first wake after 03:00")
  assert.equal(claimDailyIngest(stamp, at(23, 9)), false, "again that day")
  assert.equal(claimDailyIngest(stamp, at(23, 23)), false, "late that day")
  assert.equal(claimDailyIngest(stamp, at(24, 3)), true, "awake at 03:00 the next day")
})

test("a drain time is still there after a restart", () => {
  const stamp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "schedule-")), "drained")
  assert.equal(readDrain(stamp), null)
  rememberDrain(stamp, new Date("2026-10-22T02:00:00.000Z"))
  assert.equal(readDrain(stamp)?.toISOString(), "2026-10-22T02:00:00.000Z")
  fs.writeFileSync(stamp, "garbage")
  assert.equal(readDrain(stamp), null)
})

test("an unreadable stamp claims the daily Ingest", () => {
  const stamp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "schedule-")), "daily-ingest")
  fs.writeFileSync(stamp, "garbage")
  assert.equal(claimDailyIngest(stamp, at(23, 8)), true)
  assert.equal(claimDailyIngest(stamp, at(23, 9)), false)
})
