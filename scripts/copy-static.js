const fs = require("node:fs")
const path = require("node:path")

fs.mkdirSync("dist", { recursive: true })
for (const name of ["ask.html", "ask-box.js"]) {
  // A static .js beside a .ts of the same name would overwrite tsc's output in dist/.
  if (name.endsWith(".js") && fs.existsSync(path.join("src", name.replace(/\.js$/, ".ts")))) throw new Error(`src/${name} clashes with a .ts file`)
  fs.copyFileSync(path.join("src", name), path.join("dist", name))
}
