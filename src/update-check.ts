import { repo } from "./repo"

// The app only links to a newer GitHub release. Unsigned Mac builds can't use Squirrel, so there is no
// auto-update (spec §6). /releases/latest skips drafts and prereleases.
const latestUrl = `https://api.github.com/repos/${repo}/releases/latest`

export type NewRelease = { version: string; url: string }

// Any failure (offline, rate limit, no release yet) means no notice; the next check tries again.
export async function newerRelease(current: string, fetchFn: typeof fetch): Promise<NewRelease | null> {
  try {
    const response = await fetchFn(latestUrl, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return null
    const release = (await response.json()) as { tag_name?: unknown; html_url?: unknown }
    if (typeof release.tag_name !== "string" || typeof release.html_url !== "string") return null
    const version = release.tag_name.replace(/^v/, "")
    if (!release.html_url.startsWith("https://github.com/")) return null
    return isNewer(version, current) ? { version, url: release.html_url } : null
  } catch {
    return null
  }
}

export function isNewer(candidate: string, current: string): boolean {
  const a = numbers(candidate)
  const b = numbers(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

function numbers(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  return match ? match.slice(1).map(Number) : null
}
