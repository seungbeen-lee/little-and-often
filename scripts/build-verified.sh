#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

echo "Running bounded vinext build..."
if ! command -v timeout >/dev/null 2>&1; then
  # macOS does not ship GNU timeout. Keep the same bounded build via Node.
  exec node --input-type=module -e '
    import { spawn } from "node:child_process";
    const duration = (text) => {
      const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text);
      if (!match) throw new Error("Invalid build timeout");
      return Number(match[1]) * ({ms:1,s:1000,m:60000,h:3600000}[match[2] || "s"]);
    };
    const child = spawn(process.argv[1], ["build"], {stdio:"inherit",detached:true});
    const signal = (value) => { try { process.kill(-child.pid, value); } catch {} };
    let timedOut = false, killTimer;
    const timer = setTimeout(() => {
      timedOut = true; signal("SIGTERM");
      killTimer = setTimeout(() => signal("SIGKILL"), duration(process.env.SITES_BUILD_KILL_AFTER || "10s"));
    }, duration(process.env.SITES_BUILD_TIMEOUT || "3m"));
    child.on("error", (error) => { console.error(error.message); clearTimeout(timer); process.exitCode=1; });
    child.on("exit", (code) => { clearTimeout(timer); clearTimeout(killTimer); process.exitCode=timedOut?124:(code??1); });
    process.on("SIGINT", () => signal("SIGINT"));
    process.on("SIGTERM", () => signal("SIGTERM"));
  ' "${vinext}"
fi
timeout \
  --signal=TERM \
  --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
  "${SITES_BUILD_TIMEOUT:-3m}" \
  "${vinext}" build
