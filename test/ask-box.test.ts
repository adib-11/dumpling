import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import vm from "node:vm"

// The preload exposes window.ask through contextBridge, which makes it a global that cannot be redeclared.
test("the Ask window script runs beside the preload's window.ask and answers a question", async () => {
  const elements: Record<string, { value?: string; textContent: string; disabled?: boolean; listeners: Record<string, (event: object) => unknown> }> = {}
  const element = (id: string) => (elements[id] ??= { value: "", textContent: "", listeners: {} })
  const page = {
    document: {
      getElementById: (id: string) => {
        const node = element(id)
        return Object.assign(node, { addEventListener: (type: string, listener: (event: object) => unknown) => (node.listeners[type] = listener) })
      },
    },
  }
  const context = vm.createContext(page)
  Object.defineProperty(context, "window", { value: context })
  Object.defineProperty(context, "ask", {
    value: { question: async (question: string) => ({ ok: true, answer: `Answer to ${question}` }) },
    configurable: false,
    writable: false,
  })

  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", "ask-box.js"), "utf8"), context)
  element("question").value = "what did I save today?"
  await element("ask-form").listeners.submit({ preventDefault() {} })

  assert.equal(element("answer").textContent, "Answer to what did I save today?")
  assert.equal(element("ask-button").textContent, "Ask")
})
