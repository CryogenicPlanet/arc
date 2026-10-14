# ArcMod

A local Arc mod for account-free browsing, single-window Little Arc, and targeted
performance improvements. This repo builds a separate `ArcMod.app` using an injected
Objective-C module and version-checked patches to Arc's native app layer.

The original Arc app and its data stay untouched. ArcMod uses
`~/Library/Application Support/ArcMod` and shows an `ARC MOD` marker in the sidebar.

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

## Background browser tools

The local [MCP browser tools](notes/computer-use-tools.md) provide isolated agent
sessions, accessible page state, trusted input, awaited navigation, screenshots
and exact-agent native UI inspection. Start `bun tools/agent-mcp.ts` through your
MCP client; call `open_session` to allocate a background browser. Each agent gets
its own profile and exclusive controller lease. The native Computer Use plugin
continues to use its existing app interface.
