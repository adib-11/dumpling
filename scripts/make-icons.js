// Draws every app and tray icon from assets/logo.svg and assets/tray.svg. Run from the repo root after editing
// either SVG: node scripts/make-icons.js. The output is committed, so a build needs no extra step.
const fs = require("node:fs")
const path = require("node:path")
const { Resvg } = require("@resvg/resvg-js")

const assets = "assets"
const logo = inner(fs.readFileSync(path.join(assets, "logo.svg"), "utf8"))
const glyph = inner(fs.readFileSync(path.join(assets, "tray.svg"), "utf8"))
const logoBox = "220 226 820 820"
const tile = "#FEF5C8"
// The tray dots, as the README names them. Red for a failed Ingest, amber when Telegram has not drained.
const badges = { failing: "#D32F2F", "not-drained": "#E89B00" }

// The SVG's content without its root element, so it can be placed inside another SVG.
function inner(svg) {
  return svg.slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, svg.lastIndexOf("</svg>"))
}

function svg(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
}

function render(source, width) {
  return new Resvg(source, { fitTo: { mode: "width", value: width } }).render().asPng()
}

// The logo alone on a transparent square, for Windows and Linux.
function freeform() {
  return svg(1024, 1024, `<svg x="0" y="0" width="1024" height="1024" viewBox="${logoBox}">${logo}</svg>`)
}

// The logo on a rounded tile, on Apple's 1024 px icon grid (an 824 px tile with a 100 px margin).
function macTile() {
  return svg(
    1024,
    1024,
    `<rect x="100" y="100" width="824" height="824" rx="185" fill="${tile}"/>` +
      `<svg x="152" y="152" width="720" height="720" viewBox="${logoBox}">${logo}</svg>`,
  )
}

// A badge in the lower right corner, cut out of the art beneath so it reads at 16 px. On a Mac tray icon the
// badge is a shape, since macOS tints the whole icon one colour: a solid dot for failing, a ring for not drained.
function badged(width, height, art, state, colour) {
  if (state === "ok") return svg(width, height, art)
  const r = height * 0.25
  const cx = width - r - 0.5
  const cy = height - r - 0.5
  const mark =
    colour === null && state === "not-drained"
      ? `<circle cx="${cx}" cy="${cy}" r="${r * 0.72}" fill="none" stroke="#000" stroke-width="${r * 0.56}"/>`
      : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colour ?? "#000"}"/>`
  return svg(
    width,
    height,
    `<mask id="cut"><rect width="${width}" height="${height}" fill="#fff"/><circle cx="${cx}" cy="${cy}" r="${r * 1.3}" fill="#000"/></mask>` +
      `<g mask="url(#cut)">${art}</g>${mark}`,
  )
}

// An .icns file of PNG elements. The types are Apple's, each tied to one pixel size.
function icns(source) {
  const types = [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
    ["ic11", 32],
    ["ic12", 64],
    ["ic13", 256],
    ["ic14", 512],
  ]
  const parts = types.map(([type, size]) => {
    const png = render(source, size)
    const head = Buffer.alloc(8)
    head.write(type, 0, "latin1")
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(8)
  head.write("icns", 0, "latin1")
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

// An .ico file of PNG images, which Windows reads since Vista.
function ico(source, sizes) {
  const pngs = sizes.map((size) => render(source, size))
  const head = Buffer.alloc(6 + sizes.length * 16)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(sizes.length, 4)
  let offset = head.length
  sizes.forEach((size, i) => {
    const entry = 6 + i * 16
    head[entry] = size >= 256 ? 0 : size
    head[entry + 1] = size >= 256 ? 0 : size
    head.writeUInt16LE(1, entry + 4)
    head.writeUInt16LE(32, entry + 6)
    head.writeUInt32LE(pngs[i].length, entry + 8)
    head.writeUInt32LE(offset, entry + 12)
    offset += pngs[i].length
  })
  return Buffer.concat([head, ...pngs])
}

function write(name, data) {
  fs.mkdirSync(path.dirname(path.join(assets, name)), { recursive: true })
  fs.writeFileSync(path.join(assets, name), data)
}

write("icon.icns", icns(macTile()))
write("icon.ico", ico(freeform(), [16, 24, 32, 48, 64, 128, 256]))
fs.rmSync(path.join(assets, "icons"), { recursive: true, force: true })
for (const size of [16, 32, 48, 64, 128, 256, 512]) write(`icons/${size}x${size}.png`, render(freeform(), size))

const logoArt = (size) => `<svg width="${size}" height="${size}" viewBox="${logoBox}">${logo}</svg>`
for (const state of ["ok", "failing", "not-drained"]) {
  const colour = badges[state] ?? null
  // Mac: a one-colour template image at 22 x 16 points, with a @2x copy that Electron picks on Retina.
  const template = badged(22, 16, `<svg width="22" height="16" viewBox="0 0 22 16">${glyph}</svg>`, state, null)
  write(`tray/${state}Template.png`, render(template, 22))
  write(`tray/${state}Template@2x.png`, render(template, 44))
  // Windows and Linux trays show colour; Windows picks a size from the .ico by the screen's scale.
  const art = badged(32, 32, logoArt(32), state, colour)
  write(`tray/${state}.ico`, ico(art, [16, 20, 24, 32, 40, 48]))
  write(`tray/${state}.png`, render(art, 32))
}
