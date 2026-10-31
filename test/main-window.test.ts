import assert from "node:assert/strict"
import test from "node:test"
import { windowState } from "../src/main-window"

test("first run asks for a folder, then the Engine, then lands on Today", () => {
  assert.deepEqual(windowState({ folder: null, engine: false, bot: false }), { step: "folder", connectPhone: false })
  assert.deepEqual(windowState({ folder: "/home/ada/Documents/Dumpling", engine: false, bot: false }), {
    step: "engine",
    connectPhone: false,
  })
  assert.deepEqual(windowState({ folder: "/home/ada/Documents/Dumpling", engine: true, bot: false }), {
    step: "today",
    connectPhone: true,
  })
})

test("Today drops the Connect your phone card once a bot is connected", () => {
  assert.deepEqual(windowState({ folder: "/home/ada/Documents/Dumpling", engine: true, bot: true }), {
    step: "today",
    connectPhone: false,
  })
})
