import { repo } from "./repo"

// Short enough that the issue URL stays well under GitHub's limit.
const maxError = 500

// A new issue on .github/ISSUE_TEMPLATE/bug_report.yml, its fields filled in by id. It carries the app
// version, the system and the last Ingest error, and no Dump or Page text. The error's folder and home paths
// are replaced, so the issue does not show the Owner's user name.
export function problemReportUrl(report: {
  version: string
  system: string
  lastError: { when: string; reason: string } | null
  folder?: string | null
  home?: string
}): string {
  const url = new URL(`https://github.com/${repo}/issues/new`)
  url.searchParams.set("template", "bug_report.yml")
  url.searchParams.set("version", report.version)
  url.searchParams.set("system", report.system)
  url.searchParams.set("ingest-error", report.lastError ? describe(report.lastError, report.folder, report.home) : "None")
  return url.toString()
}

function describe(error: { when: string; reason: string }, folder?: string | null, home?: string): string {
  let reason = error.reason
  if (folder) reason = reason.split(folder).join("<folder>")
  if (home) reason = reason.split(home).join("~")
  const text = `${error.when} ${reason}`
  return text.length > maxError ? `${text.slice(0, maxError - 1)}…` : text
}

const systems: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" }

export function systemName(platform: string, version: string, arch: string): string {
  return `${systems[platform] ?? platform} ${version} ${arch}`
}
