import assert from "node:assert/strict"
import test from "node:test"
import { obsidianUrl } from "../src/obsidian"

test("obsidianUrl opens a Page by its file path, encoded", () => {
  assert.equal(
    obsidianUrl("/Users/ada/Documents/Dumpling", "people/rahim"),
    "obsidian://open?path=%2FUsers%2Fada%2FDocuments%2FDumpling%2Fvault%2Fwiki%2Fpeople%2Frahim.md",
  )
  assert.equal(
    obsidianUrl("/home/ada/My Brain", "works/a-b"),
    "obsidian://open?path=%2Fhome%2Fada%2FMy%20Brain%2Fvault%2Fwiki%2Fworks%2Fa-b.md",
  )
})

test("obsidianUrl uses the path separators of the system the folder is on", () => {
  assert.equal(
    obsidianUrl("C:\\Users\\Ada\\Dumpling", "me"),
    "obsidian://open?path=C%3A%5CUsers%5CAda%5CDumpling%5Cvault%5Cwiki%5Cme.md",
  )
})
