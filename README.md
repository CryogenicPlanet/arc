# ArcMod

A local Arc mod for account-free browsing. This repo builds a separate `ArcMod.app`
using an injected Objective-C module and version-checked patches to Arc's native app
layer. Arc runs without signing in, and its vendor services are filtered locally.

This is the `no-login` branch: it carries only the account-free changes. Single
Little Arc, the performance patches, agent sessions/browser tools and the sidebar
marker are on `master`.

The original Arc app and its data stay untouched. ArcMod uses
`~/Library/Application Support/ArcMod`.

## Requirements

- An Apple Silicon Mac with Xcode Command Line Tools (`xcode-select --install`).
- Arc **1.168.0 (88413)** installed at `/Applications/Arc.app`.
- Bun.

## Build and run

Quit ArcMod before rebuilding, then run:

```sh
bun install
bun tools/build-mod.ts
tools/run-mod.sh
```

The build clones Arc, applies the mod, and signs the copy. Use the launcher so the
local service settings and Chromium resolver rules are applied.

## Import Arc logins

To keep sites signed in, copy stock Arc's Chromium profile (cookies, site storage,
extensions, history and permissions) into ArcMod. Quit both apps first, then run:

```sh
bun tools/import-arc-data.ts
```

macOS asks to read "Arc Safe Storage". Choose **Allow**, not "Always Allow". ArcMod
uses Chromium's mock keychain, so the importer re-encrypts every OSCrypt value,
including the tracked-pref hashes. Without this, Chromium drops the extensions.
Imported sessions are then protected only by the public mock key. Arc's data is only
read. ArcMod's previous profile is kept as `Default.pre-import-<timestamp>`. Sidebar
spaces and Arc account data are not copied.

## Checks

Extract the original binary once so the binary patch tests run:

```sh
mkdir -p bin
lipo /Applications/Arc.app/Contents/MacOS/Arc -thin arm64 -output bin/Arc.arm64

bun run typecheck
bun run lint
bun run test
```

Binary tests skip when `bin/Arc.arm64` is missing. Generated binaries, app builds,
decompiles and profiles are ignored by Git.

## Repo layout

- `mods/`: injected native module and local service/shortcut policies.
- `tools/`: build, patch, launch, test and profiling scripts.
- `resources/`: native app metadata and policy definitions.
- `ghidra/scripts/`: reverse-engineering helpers.
- `notes/`: findings, runtime evidence and handoffs.

For current behavior and known issues, read [runtime status](notes/runtime-status.md).
Automatic startup window restoration remains unresolved, and the complete shortcut
inventory has not passed exhaustive live testing. [HANDOFF.md](notes/HANDOFF.md)
contains broader project context; [local mode](notes/local-mode.md) and the
[account-guard audit](notes/local-guard-audit.md) explain the native changes.
