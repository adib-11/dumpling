const fs = require("node:fs")
const path = require("node:path")

fs.mkdirSync("dist", { recursive: true })
for (const name of ["wizard.html", "wizard.js"]) {
  fs.copyFileSync(path.join("src", name), path.join("dist", name))
}
