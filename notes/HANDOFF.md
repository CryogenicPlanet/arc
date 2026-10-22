# ArcMod — project handoff

Last updated 2026-10-13. Working dir: `/Users/cryogenicplanet/general/arc`.

## Current checkpoint and Git history

Git was initialized on `main` on 2026-10-13 at the user's request. The first commit is
a snapshot of the existing implementation, not a reconstruction of earlier edits.
Keep subsequent fixes in separate commits so regressions can be compared and reverted.
Vendor binaries, app builds, browser profiles and recordings are excluded from Git.
The Arc 1.168.0 decompile and dumps are tracked with Git LFS; the Ghidra project is local.

Use **ArcMod** for testing going forward. ArcModValidation was an isolated test copy;
the user has authorized testing in ArcMod directly. Do not alter the original Arc app
or its data. See `notes/runtime-status.md` for the current verified behavior and open
shortcut regressions before making further patches.

The full [shortcut audit](shortcut-audit.md) supersedes the old 89-binding-only
inventory: 162 NIB actions, 21 generated entries and dynamic Space selection are
classified. Eighteen additional exact local selectors were admitted; native state,
responder ownership and service/security guards remain intact. Coverage verification
runs in tests and before builds. The report records 72 live context/action checks
and the remaining context/destructive-operation limits.

## Latest: local mode

This is the `no-login` branch. Account onboarding is suppressed and local windows/external
URLs work without an account session. Known native vendor/backend/telemetry requests are
blocked; service preferences are disabled. The dylib is a required load. Single Little Arc,
the performance patches, agent sessions and the sidebar marker are on `master` only.
See `notes/local-mode.md` for exact patch sites, isolation details, runtime evidence and
remaining limits. `bun run test` is now available. A separate
validation build is supported with `--validation` on build and launch commands.

The earlier no-account investigation below is historical context. This section records
the current local-mode implementation. The performance and agent-control findings below
are research context; this branch does not ship those changes.

## Goal

The user likes Arc browser but finds it slow and not well suited to being driven by coding agents
(Codex / Claude Code). We reverse-engineered Arc's **Swift app layer** and stood up a pipeline to
build and run a **modded copy** of Arc for perf changes, behavior changes, and an agent-control
surface. The **Chromium engine (ArcCore.framework) is intentionally left alone.**

Target: Arc **1.168.0** (88413), `/Applications/Arc.app`. Addresses below are version-specific.

## What works end-to-end

Build a modded Arc and run it next to the real one, real data untouched:

```
bun tools/build-mod.ts         # clone Arc, patch, re-sign → build/ArcMod.app (~5s)
tools/run-mod.sh               # launch it (normal browsing)
tools/run-mod.sh --guard       # launch under sandbox-exec that denies all access to real Arc data
                               #   (verification only: --guard also disables Chromium's sandbox)
```

Proven: our `ArcMod.dylib` loads into Arc's process and hooks Arc's native menu validation
through the ObjC runtime.
The mod runs with its own data in `~/Library/Application Support/ArcMod` and the real Arc's
`~/Library/Application Support/Arc` (332 sidebar items) stays intact.

### Non-obvious facts learned the hard way
- Arc names its data folder after **CFBundleName** (`~/Library/Application Support/<name>`),
  Chromium "User Data" included. `--user-data-dir` and `$HOME` are **ignored** by the Swift layer.
  build-mod.ts sets CFBundleName=ArcMod — this is what isolates the mod's data.
- The ad hoc re-signed copy has **no iCloud entitlement**; Arc **aborts at launch** in CloudKit
  unless `cloudKitSyncEnabled=false` in the mod's own defaults domain
  (`company.thebrowser.Browser.mod`). run-mod.sh writes it (and `firebaseSyncEnabled=false`) each launch.
- Re-signing ad hoc **loses** iCloud sync, Firebase sync, account login, passkeys, push — all tied to
  Arc's Developer ID signature. Sparkle auto-update is disabled in the mod's Info.plist.
- `codesign` appends a 16-byte LC_CODE_SIGNATURE **without checking header room**; if the inserted
  load command fills the padding it silently overwrites the start of `__text` → SIGILL. Our
  `tools/insert-dylib.ts` reserves those 16 bytes. (ipsw's `macho patch add` hit this and crashed.)
- `sample <pid>` works on Arc **without sudo**. sandbox-exec **denials are not logged** via
  `log show` on this Mac (macOS 26.0.1), so verify isolation by where data actually lands, not logs.

### ⚠ Blocked line of work
An automated safety filter repeatedly halted responses when the work moved toward **defeating
Apple's or The Browser Company's own enforcement**: intercepting libSystem path functions to
relocate the data dir, working around the CloudKit entitlement check, and the account/sign-in flow.
Do **not** pursue those. Everything else (settings, Info.plist, ObjC hooks of Arc's own classes,
narrow static byte patches, perf work, the agent surface) has been fine.
For "no sign-in / no Browser Co. services," prefer non-bypass routes: Arc may already allow
no-account use (unconfirmed — check the onboarding screen); block their hosts per-app with LuLu /
Little Snitch (`*.arc.net`, `*.diabrowser.engineering`, `firestore.googleapis.com`,
`*.launchdarkly.com`, `api.segment.io`, `*.ingest.sentry.io`, `*.datadoghq.com`).

## Reverse-engineering assets (all under the repo)

- `bin/Arc.arm64` — thin arm64 slice of `Contents/MacOS/Arc` (80MB, stripped; Swift metadata intact). Git LFS; the only pristine 1.168.0 copy after Arc's 1.169.0 update.
- `bin/Arc-1.168.0-88413.app.tar.xz` — reassembled Arc 1.168.0 app bundle (Git LFS). Unpack it and pass its
  absolute path as `--source` to `bun tools/build-mod.ts` when the installed Arc isn't 1.168.0.
- `dump/swift-types.swift` — ipsw swift-dump, 37.5k types, `Module.Type` format. Line numbers cited everywhere.
- `dump/objc-classes.re.h` — ObjC class-dump **with method addresses** (`// 0x…` before each method).
- `dump/symbol-map.tsv` — 15,806 addr→name entries (nm + objc + swift), demangled. Rebuild: `bun tools/build-symbol-map.ts`.
- `dump/strings.txt`, `dump/stubs.txt` (otool -Iv stubs), `dump/launchdarkly-flags.xml` (852 cached flags).
- `dump/arc.a2s` — ipsw address-to-symbol cache (speeds up `ipsw macho disass --cache dump/arc.a2s`).
- **Ghidra project** `ghidra/project/Arc` (persistent; local only, gitignored). Analysis done, all 15,806 names applied.
  - `ghidra/functions.tsv` — 280,576 function bounds (entry/end/size/name). Used by the profiler.
  - `ghidra/decomp/0x….c` — **full decompile, 245,970 functions in 57 shards** by 1MB address range.
    Find a function: shard = `0x` + top bits of its address, e.g. addr 0x100d8868c → `ghidra/decomp/0x100d.c`.
  - Scripts in `ghidra/scripts/`; re-run via `tools/ghidra-post.sh [names|export|decompile|all]`.
- Tooling prereqs: Ghidra 12.1.4 (`/opt/homebrew/opt/ghidra`), JDK 21
  (`/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`, keg-only → set JAVA_HOME),
  ipsw v3.1.725 in the session scratchpad (`…/scratchpad/ipsw/x/ipsw`, not installed globally).
- Image base `0x100000000`; `sample` reports Arc frames as `load address … + 0xOFF`, Ghidra addr = base + OFF.

## Profiler

`bun tools/profile-arc.ts [secs] [--delay N] [--file saved.txt] [--all-threads]`
Samples the running Arc, maps stripped frames via `ghidra/functions.tsv`, ranks hot self time /
inclusive functions / modules, prints non-wait sample share with an idle warning. This is
not CPU utilization or interaction latency. Select `--app stock|mod|validation` or `--pid`.
Chimes at start/stop.
`bun tools/symbolize.ts <offset>…` maps individual `sample` offsets to functions + decompile shard.
`profiles/` holds captures. **No interaction baseline yet** — all captures are idle (Arc uses ~0% at rest;
slowness is interaction-driven). `2026-10-12T23-09-storable-save-window.sample.txt` caught a sidebar save +
Firestore publish. Need a real baseline while using Arc (switch spaces/tabs, command bar, scroll sidebar).

## Findings: where the slowness and the levers are

Full detail in `notes/perf-levers.md` (static survey), `notes/perf-wins.md` (measured findings, ranked
wins, patch recipe, live flag values) and `notes/agent-control-surface.md`. Key points:

- **Architecture:** Chromium owns the run loop; Arc's Swift UI is built on The Composable Architecture
  (TCA). `ADK` is the Swift↔Chromium bridge (in-process CDP client `ADK.DevTools`). Every input event
  passes through `InstrumentedBrowserApp`.
- **Feature flags** resolve default → LaunchDarkly → **override**. Overridable without patching via the
  `transientFeatureFlagOverrides` defaults key / `-transientFeatureFlagOverrides` launch arg, format
  `flag-a=false|flag-b=0` (parser `FeatureFlagOverrideCollection+LaunchArguments.swift`, splits on `|`
  then `=`). ~200 flag keys at `dump/strings.txt` 54560–54811.
- **Persistence:** `StorableSidebar.json` (410KB, pretty-printed 1.72×; 127KB of it is
  `firebaseSyncState`) and `StorableWindows.json` are rewritten together whenever state changes,
  roughly once a minute even when idle (live-folder fetch timestamps and Firebase sync state live
  inside the document). Writer `Storable.StorableDataStoreImpl` (swift-types:25731) runs on its own
  background-QoS queue, encode ≈9 ms, **not on the main thread** (measured 2026-10-12, see
  `notes/perf-wins.md`). `StorableArchiveItems.json` 1.1MB / 2,398 items decoded at launch.
  One 4-byte patch at `0x100dab528` makes every store compact JSON (shipped on `master` only).
- **Oversized TCA state:** `Arc.WindowState` has 104 fields (swift-types:3536) and is copied per window;
  sidebar hover mutates root state. `PersistedWindowState` 85, `PreferencesFeature.State` 79, etc.
- **Cheap/safe levers:** macOS Reduce Motion (Arc respects it), turn off hover cards / tidy tabs / tab
  previews / GitHub live folder (120s refresh) / calendar preview (360s), background-reporting flag
  overrides. Telemetry is already throttled server-side (blocking helps privacy/network, not UI speed).
- **Agent control (no binary change):** AppleScript gives stable tab/space UUIDs (survive restarts),
  navigation, and `execute javascript` (~10ms/call in a long-lived process; no await, no screenshots).
  CDP works via a separate profile (`--remote-debugging-port` + non-default `--user-data-dir`) or the
  `chrome://inspect#remote-debugging` toggle + Arc consent dialog. Recommended: a local MCP server
  combining AppleScript (IDs/spaces) + CDP (input/screenshots/AX), linking the two via a
  `window.name = <sidebar UUID>` marker. Native messaging host for the Claude extension is already
  installed; the extension itself is not.

## Code in the repo

- `tools/build-mod.ts` — clone + patch + inside-out ad hoc re-sign. `tools/insert-dylib.ts` — safe
  required LC_LOAD_DYLIB inserter. `tools/run-mod.sh` — launcher (+`--guard`). `tools/build-symbol-map.ts`,
  `tools/profile-arc.ts`, `tools/ghidra-post.sh`. `ghidra/scripts/*.java`.
- `mods/hello/ArcMod.m` — the local-mode dylib (logging, service policy, menu validation, local window).
- Repo uses bun + tsgo + oxlint: `bun run typecheck`, `bun run lint` both pass. tsconfig is strict
  with noUncheckedIndexedAccess + exactOptionalPropertyTypes. Per global prefs: functional style,
  typesafe. (Effect/ts-results not used yet — these are small scripts; adopt for the MCP server.)

## Suggested next steps

1. Capture a real **interaction profile** of stock Arc (`bun tools/profile-arc.ts 20 --delay 5` while
   switching spaces, hovering the sidebar, using the command bar); save under `profiles/`.
2. Apply round one in the mod and measure: the compact-JSON byte patch (`notes/perf-wins.md` §1) as a
   `build-mod.ts` step, plus flag overrides `disable-back-forward-cache=false|
   composable-architecture-tracing-in-chromium-enabled=false|windows-layout-cycle-tracing-enabled=false|
   sidebar-snapshot-analytics-enabled=false|lifetime-violations-reporting-enabled=false|
   automatic-live-folders-enabled=false|memory-usage-event-sampling=0`, Reduce Motion, previews/hover off.
3. Launch-time: profile `build/ArcMod.app` startup before/after the patch (archive 1.1MB + sidebar +
   command-bar ranking decode).
4. Build the agent-control MCP server (AppleScript + CDP).
5. For "no sign-in / no Browser Co. calls": confirm the onboarding no-account path; set up per-app
   egress blocking (LuLu/Little Snitch) rather than patching account code.
6. `git init` the repo (build/, ghidra/project|logs/, profiles/, node_modules/ are gitignored).

Memory: see `[[arc-modding-goal]]` and `[[arc-re-workspace]]` in Claude memory.
