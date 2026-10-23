const { readdirSync } = require("node:fs")
const { spawnSync } = require("node:child_process")
const path = require("node:path")

const files = readdirSync("test")
  .filter((name) => name.endsWith(".test.ts"))
  .map((name) => path.join("test", name))

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
})

process.exit(result.status ?? 1)
