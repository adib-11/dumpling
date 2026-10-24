import path from "node:path"

// Brains with an Ingest or Undo under way. The app is single-instance, so an in-process lock is enough,
// and a crash or quit never leaves it held.
const busy = new Set<string>()

// Returns the unlock function, or null when the brain is already locked.
export function lockBrain(brain: string): (() => void) | null {
  const key = path.resolve(brain)
  if (busy.has(key)) return null
  busy.add(key)
  return () => busy.delete(key)
}

export function brainLocked(brain: string): boolean {
  return busy.has(path.resolve(brain))
}
