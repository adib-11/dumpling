import type { Outcome } from "./main-window"

// The global shortcut that opens the capture box (spec v0.2 §6). Shared by the main process and the Settings
// renderer, so it imports nothing but types.

// Electron reads Alt as Option on a Mac, so this is ⌃⌥Space there and Ctrl+Alt+Space elsewhere.
export const defaultShortcut = "Control+Alt+Space"

const modifierOrder = ["Control", "Alt", "Shift", "Command", "Super"]

// KeyboardEvent.code to the key name Electron's accelerators use. Letters, digits and F-keys are added below.
const namedKeys: Record<string, string> = {
  Space: "Space",
  Tab: "Tab",
  Enter: "Return",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
}

const keys = new Set([
  ...Object.values(namedKeys),
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  ...Array.from({ length: 10 }, (_, i) => String(i)),
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
])

export type KeyPress = { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }

function keyName(code: string): string | undefined {
  return /^Key([A-Z])$/.exec(code)?.[1] ?? /^Digit(\d)$/.exec(code)?.[1] ?? (/^F\d+$/.test(code) ? code : namedKeys[code])
}

// The accelerator for keys pressed in Settings, or null while it is not a shortcut yet: a bare key, Shift alone
// and a modifier alone would catch ordinary typing.
export function acceleratorFromKey(press: KeyPress, platform: string): string | null {
  const key = keyName(press.code)
  if (!key) return null
  const held = [
    press.ctrlKey && "Control",
    press.altKey && "Alt",
    press.shiftKey && "Shift",
    press.metaKey && (platform === "darwin" ? "Command" : "Super"),
  ].filter((each): each is string => each !== false)
  const accelerator = [...held, key].join("+")
  return isAccelerator(accelerator) ? accelerator : null
}

// Whether `text` is an accelerator this app makes: modifiers, at least one besides Shift, then one key.
export function isAccelerator(text: string): boolean {
  const parts = text.split("+")
  const key = parts.pop() ?? ""
  if (!keys.has(key)) return false
  if (new Set(parts).size !== parts.length) return false
  if (!parts.every((part) => modifierOrder.includes(part))) return false
  return parts.some((part) => part !== "Shift")
}

// What the Owner reads: ⌃⌥Space on a Mac, Ctrl+Alt+Space elsewhere.
export function shortcutLabel(accelerator: string, platform: string): string {
  const parts = accelerator.split("+")
  const key = parts.pop() ?? ""
  if (platform === "darwin") {
    const symbols: Record<string, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Command: "⌘", Super: "⌘" }
    return `${modifierOrder.filter((each) => parts.includes(each)).map((each) => symbols[each]).join("")}${key}`
  }
  const names: Record<string, string> = {
    Control: "Ctrl",
    Alt: "Alt",
    Shift: "Shift",
    Command: "Win",
    Super: platform === "win32" ? "Win" : "Super",
  }
  return [...parts.map((part) => names[part] ?? part), key].join("+")
}

// The part of Electron's globalShortcut this uses. `register` is false when the system keeps the shortcut for
// another app, and may throw on an accelerator it cannot read.
export type ShortcutRegistry = {
  register(accelerator: string, press: () => void): boolean
  unregister(accelerator: string): void
}

export type ShortcutStatus = { accelerator: string; label: string; registered: boolean }

// Holds the one capture shortcut. A change registers the new one before letting the old one go, so a refused
// change leaves the old shortcut working.
export function createCaptureShortcut(registry: ShortcutRegistry, platform: string, press: () => void) {
  let accelerator: string = defaultShortcut
  let registered = false

  function tryRegister(wanted: string): boolean {
    try {
      return registry.register(wanted, press)
    } catch {
      return false
    }
  }

  const status = (): ShortcutStatus => ({ accelerator, label: shortcutLabel(accelerator, platform), registered })

  return {
    status,
    start(wanted: string): ShortcutStatus {
      accelerator = wanted
      registered = tryRegister(wanted)
      return status()
    },
    change(wanted: string): Outcome {
      if (!isAccelerator(wanted)) return { ok: false, error: "Press Ctrl, Alt or Cmd together with another key." }
      if (registered && wanted === accelerator) return { ok: true }
      if (!tryRegister(wanted)) {
        const still = registered ? ` Still using ${shortcutLabel(accelerator, platform)}.` : ""
        return { ok: false, error: `The system did not give Dumpling ${shortcutLabel(wanted, platform)}.${still} Try another.` }
      }
      if (registered) registry.unregister(accelerator)
      accelerator = wanted
      registered = true
      return { ok: true }
    },
  }
}
