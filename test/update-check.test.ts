import assert from "node:assert/strict"
import test from "node:test"
import { trayMenuItems } from "../src/tray-menu"
import { isNewer, newerRelease } from "../src/update-check"

function latest(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch
}

test("a newer version compares by number, not by text", () => {
  assert.equal(isNewer("0.2.0", "0.1.0"), true)
  assert.equal(isNewer("0.10.0", "0.9.0"), true)
  assert.equal(isNewer("1.0.0", "0.99.99"), true)
  assert.equal(isNewer("0.1.0", "0.1.0"), false)
  assert.equal(isNewer("0.1.0", "0.2.0"), false)
  assert.equal(isNewer("0.2.0-beta.1", "0.1.0"), false)
})

test("the app links to a newer GitHub release, and stays quiet otherwise", async () => {
  const url = "https://github.com/adib-11/dumpling/releases/tag/v0.2.0"
  assert.deepEqual(await newerRelease("0.1.0", latest({ tag_name: "v0.2.0", html_url: url })), {
    version: "0.2.0",
    url,
  })
  assert.equal(await newerRelease("0.2.0", latest({ tag_name: "v0.2.0", html_url: url })), null)
  assert.equal(await newerRelease("0.1.0", latest({ message: "Not Found" }, 404)), null)
  assert.equal(await newerRelease("0.1.0", latest({ tag_name: "v0.2.0", html_url: "https://evil.example/" })), null)
  const offline = (async () => {
    throw new TypeError("fetch failed")
  }) as typeof fetch
  assert.equal(await newerRelease("0.1.0", offline), null)
})

test("the update check asks the adib-11/dumpling repo", async () => {
  let asked = ""
  const fetchFn = (async (input: string | URL | Request) => {
    asked = String(input)
    return new Response("{}", { status: 404 })
  }) as typeof fetch
  await newerRelease("0.1.0", fetchFn)
  assert.equal(asked, "https://api.github.com/repos/adib-11/dumpling/releases/latest")
})

test("the tray shows a new version above Quit", () => {
  assert.deepEqual(trayMenuItems(null, false, false, null, "0.2.0"), [
    { label: "Choose folder…", action: "setup", enabled: true },
    { label: "New version 0.2.0…", action: "update", enabled: true },
    { label: "Report a problem", action: "report", enabled: true },
    { label: "Quit", action: "quit", enabled: true },
  ])
  assert.deepEqual(trayMenuItems("/home/ada/Dumpling", true, false, null, "0.2.0").slice(-3), [
    { label: "New version 0.2.0…", action: "update", enabled: true },
    { label: "Report a problem", action: "report", enabled: true },
    { label: "Quit", action: "quit", enabled: true },
  ])
})
