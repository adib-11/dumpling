import assert from "node:assert/strict"
import test from "node:test"
import { acceleratorFromKey, createCaptureShortcut, defaultShortcut, isAccelerator, shortcutLabel } from "../src/shortcut"

// A registry that the system lets hold only the accelerators in `allowed`; it records what is held.
function system(allowed: string[], throwing = false) {
  const held = new Set<string>()
  return {
    held,
    register(accelerator: string, _press: () => void) {
      if (throwing) throw new Error("bad accelerator")
      if (!allowed.includes(accelerator)) return false
      held.add(accelerator)
      return true
    },
    unregister(accelerator: string) {
      held.delete(accelerator)
    },
  }
}

test("the default is Control+Alt+Space, shown as ⌃⌥Space on a Mac and Ctrl+Alt+Space elsewhere", () => {
  assert.equal(defaultShortcut, "Control+Alt+Space")
  assert.equal(shortcutLabel(defaultShortcut, "darwin"), "⌃⌥Space")
  assert.equal(shortcutLabel(defaultShortcut, "win32"), "Ctrl+Alt+Space")
  assert.equal(shortcutLabel("Control+Alt+Space", "linux"), "Ctrl+Alt+Space")
  assert.equal(shortcutLabel("Command+Shift+K", "darwin"), "⇧⌘K")
  assert.equal(shortcutLabel("Super+Shift+K", "win32"), "Win+Shift+K")
})

test("starting registers the shortcut and reports it held", () => {
  const registry = system([defaultShortcut])
  const shortcut = createCaptureShortcut(registry, "linux", () => {})

  assert.deepEqual(shortcut.start(defaultShortcut), { accelerator: defaultShortcut, label: "Ctrl+Alt+Space", registered: true })
  assert.deepEqual([...registry.held], [defaultShortcut])
})

test("a shortcut the system refuses at start is reported not held", () => {
  const shortcut = createCaptureShortcut(system([]), "linux", () => {})

  assert.deepEqual(shortcut.start(defaultShortcut), { accelerator: defaultShortcut, label: "Ctrl+Alt+Space", registered: false })
  assert.equal(shortcut.status().registered, false)
})

test("changing to a shortcut the system gives moves to it and lets the old one go", () => {
  const registry = system([defaultShortcut, "Control+Alt+K"])
  const shortcut = createCaptureShortcut(registry, "linux", () => {})
  shortcut.start(defaultShortcut)

  const result = shortcut.change("Control+Alt+K")

  assert.deepEqual(result, { ok: true })
  assert.deepEqual([...registry.held], ["Control+Alt+K"])
  assert.deepEqual(shortcut.status(), { accelerator: "Control+Alt+K", label: "Ctrl+Alt+K", registered: true })
})

test("a refused change says so and keeps the old shortcut held", () => {
  const registry = system([defaultShortcut])
  const shortcut = createCaptureShortcut(registry, "linux", () => {})
  shortcut.start(defaultShortcut)

  const result = shortcut.change("Control+Alt+K")

  assert.deepEqual(result, {
    ok: false,
    error: "The system did not give Dumpling Ctrl+Alt+K. Still using Ctrl+Alt+Space. Try another.",
  })
  assert.deepEqual([...registry.held], [defaultShortcut])
  assert.deepEqual(shortcut.status(), { accelerator: defaultShortcut, label: "Ctrl+Alt+Space", registered: true })
})

test("a refused change when nothing is held asks for another without claiming an old one", () => {
  const shortcut = createCaptureShortcut(system([]), "linux", () => {})
  shortcut.start(defaultShortcut)

  assert.deepEqual(shortcut.change("Control+Alt+K"), {
    ok: false,
    error: "The system did not give Dumpling Ctrl+Alt+K. Try another.",
  })
  assert.equal(shortcut.status().accelerator, defaultShortcut)
})

test("a change the system throws on is a refusal, not a crash", () => {
  const registry = system([defaultShortcut])
  const shortcut = createCaptureShortcut(registry, "linux", () => {})
  shortcut.start(defaultShortcut)
  registry.register = () => {
    throw new Error("bad accelerator")
  }

  const result = shortcut.change("Control+Alt+K")

  assert.equal(result.ok, false)
  assert.deepEqual([...registry.held], [defaultShortcut])
})

test("something that is not an accelerator is refused without asking the system", () => {
  const registry = system(["Control+Alt+K"])
  const shortcut = createCaptureShortcut(registry, "linux", () => {})
  shortcut.start(defaultShortcut)

  for (const bad of ["", "K", "Shift+K", "Control+Alt", "Control+Alt+K+L", "Hyper+K", "Control+Alt+Ünicode"]) {
    const result = shortcut.change(bad)
    assert.equal(result.ok, false, bad)
    assert.equal(isAccelerator(bad), false, bad)
  }
  assert.equal(registry.held.size, 0)
})

test("choosing the shortcut already held changes nothing", () => {
  const registry = system([defaultShortcut])
  const shortcut = createCaptureShortcut(registry, "linux", () => {})
  shortcut.start(defaultShortcut)

  assert.deepEqual(shortcut.change(defaultShortcut), { ok: true })
  assert.deepEqual([...registry.held], [defaultShortcut])
})

test("pressing the held shortcut runs the handler", () => {
  let press: (() => void) | undefined
  let pressed = 0
  const shortcut = createCaptureShortcut(
    {
      register(_accelerator, callback) {
        press = callback
        return true
      },
      unregister() {},
    },
    "darwin",
    () => pressed++,
  )
  shortcut.start(defaultShortcut)

  press?.()

  assert.equal(pressed, 1)
})

test("keys pressed in the Settings box become an accelerator", () => {
  const key = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>>) => ({
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  })

  assert.equal(acceleratorFromKey(key("Space", { ctrlKey: true, altKey: true }), "darwin"), "Control+Alt+Space")
  assert.equal(acceleratorFromKey(key("KeyK", { ctrlKey: true, altKey: true, shiftKey: true }), "win32"), "Control+Alt+Shift+K")
  assert.equal(acceleratorFromKey(key("Digit7", { metaKey: true }), "darwin"), "Command+7")
  assert.equal(acceleratorFromKey(key("Digit7", { metaKey: true }), "linux"), "Super+7")
  assert.equal(acceleratorFromKey(key("F9", { ctrlKey: true }), "linux"), "Control+F9")
  assert.equal(acceleratorFromKey(key("ArrowUp", { altKey: true }), "linux"), "Alt+Up")
  // A bare key, Shift alone, or only a modifier is not a shortcut yet.
  assert.equal(acceleratorFromKey(key("KeyK", {}), "linux"), null)
  assert.equal(acceleratorFromKey(key("KeyK", { shiftKey: true }), "linux"), null)
  assert.equal(acceleratorFromKey(key("ControlLeft", { ctrlKey: true }), "linux"), null)
  assert.equal(acceleratorFromKey(key("Escape", { ctrlKey: true }), "linux"), "Control+Escape")
  // Every accelerator it makes is one the main process accepts.
  assert.equal(isAccelerator("Control+Alt+Shift+K"), true)
  assert.equal(isAccelerator("Control+F9"), true)
})
