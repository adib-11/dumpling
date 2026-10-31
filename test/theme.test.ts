import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const root = path.join(__dirname, "..")
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8")
const theme = read("src/theme.css")

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]))
}

const light = tokens(theme.slice(theme.indexOf(":root"), theme.indexOf("}", theme.indexOf(":root"))))
const darkBlock = theme.slice(theme.indexOf("@media (prefers-color-scheme: dark)"))
const dark = { ...light, ...tokens(darkBlock.slice(0, darkBlock.indexOf("}"))) }

// WCAG 2.2 contrast ratio between two #rrggbb colours.
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test("contrast is measured as WCAG defines it", () => {
  assert.equal(contrast("#000000", "#ffffff"), 21)
  assert.equal(contrast("#777777", "#ffffff").toFixed(2), "4.48")
})

// Text needs 4.5:1 (WCAG 1.4.3). Input borders and the focus ring need 3:1 (WCAG 1.4.11).
const pairs: [string, string, number][] = [
  ["text", "bg", 4.5],
  ["text", "surface", 4.5],
  ["text-muted", "bg", 4.5],
  ["text-muted", "surface", 4.5],
  ["accent-text", "bg", 4.5],
  ["accent-text", "surface", 4.5],
  ["on-accent", "accent", 4.5],
  ["danger", "bg", 4.5],
  ["danger", "surface", 4.5],
  ["border-strong", "surface", 3],
  ["border-strong", "bg", 3],
  ["focus", "bg", 3],
  ["focus", "surface", 3],
]

for (const [scheme, set] of [
  ["light", light],
  ["dark", dark],
] as const) {
  test(`text and controls meet WCAG AA contrast in ${scheme} mode`, () => {
    for (const [fore, back, minimum] of pairs) {
      assert.match(set[fore] ?? "", /^#[0-9a-f]{6}$/i, `--${fore}`)
      assert.match(set[back] ?? "", /^#[0-9a-f]{6}$/i, `--${back}`)
      const ratio = contrast(set[fore], set[back])
      assert.ok(ratio >= minimum, `--${fore} on --${back} is ${ratio.toFixed(2)}:1 in ${scheme} mode, under ${minimum}:1`)
    }
  })
}

test("dark mode sets every colour light mode sets", () => {
  const colours = Object.keys(light).filter((name) => light[name].startsWith("#"))
  const darkOwn = tokens(darkBlock.slice(0, darkBlock.indexOf("}")))
  assert.deepEqual(colours.filter((name) => !(name in darkOwn)), [])
})

test("every window loads the theme and takes its colours from it", () => {
  assert.match(read("renderer/main.tsx"), /import "\.\.\/src\/theme\.css"/)
  assert.match(read("src/ask.html"), /<link rel="stylesheet" href="theme\.css" \/>/)
  for (const file of ["renderer/style.css", "src/ask.html", ...fs.readdirSync(path.join(root, "renderer")).filter((name) => name.endsWith(".tsx")).map((name) => `renderer/${name}`)]) {
    assert.doesNotMatch(read(file), /#(?:[0-9a-f]{3}){1,2}\b|rgba?\(|hsla?\(/i, `${file} has a colour of its own`)
  }
})
