# ArcMod: handoff

Updated 2026-10-24. Read this, then [runtime-status.md](runtime-status.md) for what currently works and
what doesn't. Runtime status wins where older notes disagree.

## What this is

ArcMod is a patched copy of Arc **1.168.0 (88413), arm64**, built next to the real Arc with its own bundle
ID, name and data folder. It runs without an Arc account, blocks The Browser Company's services, and adds
tools for coding agents. `/Applications/Arc.app` and the original Arc profile are never modified.

- One branch, `master`. The extras (sidebar marker, icon badge, One Little Arc, agent tools, update
  checks) are switches in Settings → ArcMod; the old `no-login` branch is archived as the
  `no-login-final` tag.
- The engine (`ArcCore.framework`) is Arc's own by default. Our replacement built from Chromium source is
  [Arc Engine](https://github.com/CryogenicPlanet/arc-engine), included as the `engine/` submodule. For
  engine development, clone it next to this repo as `../arc-engine`; its tests expect that layout.

## Where things are documented

- [local-mode.md](local-mode.md) and [local-guard-audit.md](local-guard-audit.md): every account-free patch
  and the guards that were resolved, with addresses.
- [shortcut-audit.md](shortcut-audit.md) and `shortcut-inventory.json`: all 162 menu actions and their
  shortcut routing.
- [agent-sessions.md](agent-sessions.md) and [computer-use-tools.md](computer-use-tools.md): isolated agent
  builds and the MCP browser tools. [browser-agent-benchmark-2026-10-13.md](browser-agent-benchmark-2026-10-13.md)
  compares them with Computer Use.
- [perf-wins.md](perf-wins.md): measured performance findings from 2026-10-12. Historical; what was applied
  is in runtime-status.md.

## Build and run

```sh
bun tools/build-mod.ts                 # /Applications/ArcMod.app from Arc 1.168.0 (installed, or bin/'s copy)
bun tools/build-mod.ts --debug         # build/ArcMod.app instead of installing
bun tools/build-mod.ts --source <abs path to a 1.168.0 Arc.app>
bun tools/build-mod.ts --agent <slug>  # an isolated agent build: own bundle, data and windows
bun tools/build-mod.ts --validation    # a separate test copy, ArcModValidation
bun tools/build-mod.ts --engine <ArcCore.framework>   # swap in another engine (ours)
tools/run-mod.sh [--agent <slug> | --validation | --debug | --app <path>]  # launch from the repo (ArcMod also opens like any app)
tools/run-mod.sh --guard               # sandbox that denies access to real Arc data (testing only)
```

Quit ArcMod before rebuilding; the builder replaces the app bundle. `bin/Arc-1.168.0-88413.app.tar.xz`
is a pristine 1.168.0 app to pass as `--source` when the installed Arc has updated.

## Rules

- Keep patches narrow and fingerprinted. Resolve account guards at their call sites; never change global
  authentication getters, and never create a fake account or token.
- Don't defeat Apple's or The Browser Company's own enforcement: no working around entitlement checks,
  no interposing libSystem path functions to relocate data, no forging the sign-in flow.
- Use disposable localhost tabs and agent builds for testing. Don't commit browser data, credentials, app
  bundles or profiling captures.

## Non-obvious facts

- Arc names its data folder after **CFBundleName** (`~/Library/Application Support/<name>`), Chromium's
  User Data included. `--user-data-dir` and `$HOME` are ignored by the Swift layer, so the builder's
  CFBundleName is what separates ArcMod's data.
- The ad hoc re-signed copy has no iCloud entitlement, and Arc aborts at launch in CloudKit unless
  `cloudKitSyncEnabled=false` is set in the mod's defaults domain. ArcMod.dylib writes it at load (and
  `firebaseSyncEnabled=false`) on every launch. Re-signing also loses Firebase sync, account login,
  passkeys and push, which are tied to Arc's Developer ID signature. Sparkle updates are disabled.
- `codesign` appends a 16-byte load command without checking header room. If an inserted load command
  fills the padding, it overwrites the start of `__text` (SIGILL). `tools/insert-dylib.ts` reserves room.
- Feature flags resolve default → LaunchDarkly → override. Overrides need no patch: the
  `transientFeatureFlagOverrides` defaults key or `-transientFeatureFlagOverrides 'flag-a=false|flag-b=0'`.
  ArcMod starts LaunchDarkly offline, so flags otherwise take their code defaults.
- Arc's UI is The Composable Architecture (TCA) on top of `ADK`, an in-process DevTools client into
  Chromium. Chromium owns the run loop.
- `sample <pid>` works on Arc without sudo. sandbox-exec denials aren't logged on this macOS, so check
  isolation by where data actually lands.

## Reverse-engineering assets

- `bin/Arc.arm64`: thin arm64 slice of Arc 1.168.0's executable (stripped; Swift metadata intact), in LFS.
- `dump/swift-types.swift` (Swift types; line numbers are cited across the notes), `dump/objc-classes.re.h`
  (ObjC classes with method addresses), `dump/symbol-map.tsv` (15,806 address → name entries, rebuilt by
  `bun tools/build-symbol-map.ts`), `dump/strings.txt`, `dump/stubs.txt`, `dump/launchdarkly-flags.xml`
  (852 cached flags), `dump/arc.a2s` (ipsw symbol cache).
- `ghidra/decomp/0x….c`: the full decompile, 245,970 functions in 57 shards by 1 MB address range. Address
  0x100d8868c is in `ghidra/decomp/0x100d.c`. `ghidra/functions.tsv` has every function's bounds. The
  analyzed Ghidra project (`ghidra/project/Arc`) is local only; `tools/ghidra-post.sh` reruns the exports.
- Image base is `0x100000000`. `sample` prints `load address + 0xOFF`; the Ghidra address is base + OFF.
- Tools: Ghidra 12.1.4 (`/opt/homebrew/opt/ghidra`) with JDK 21 (keg-only; set `JAVA_HOME`), ipsw 3.1.725.

## Profiling

`bun tools/profile-arc.ts [secs] [--delay N] [--app stock|mod|validation | --pid N]` samples a running Arc
and maps stripped frames through `ghidra/functions.tsv`. It ranks hot functions and reports the non-wait
sample share; that isn't CPU utilization or latency. `bun tools/symbolize.ts <offset>…` maps single
offsets. Arc is idle at rest, so profile while switching spaces, hovering the sidebar or using the
command bar.
