# ArcMod

> **Work in progress.** This is an experimental mod I use day to day. Expect rough
> edges. I'll share more details on making the experience better over time.

ArcMod is a modified copy of the [Arc browser](https://arc.net) for macOS. You can
browse without signing in, Arc's own services are blocked, it's a little lighter, and
it adds tools that let coding agents (Codex, Claude Code) drive the browser.

It builds a **separate app** next to your normal Arc. Your installed Arc and its data
are never modified.

Not affiliated with The Browser Company.

## Which branch?

| Branch | What you get |
| --- | --- |
| `master` | Everything below: no sign-in, service blocking, one Little Arc, performance tweaks, agent browser tools and an `ARC MOD` sidebar marker. |
| `no-login` | Only what's needed to use Arc without an account, plus service blocking. |

## What it does

- **No sign-in.** The account onboarding screen never opens. Windows, tabs, links,
  keyboard shortcuts and Settings work without an account. No fake account or token
  is created; Arc's own account checks are left in place.
- **Blocks The Browser Company's services.** Requests from Arc's native code to its
  backend, sync, LaunchDarkly, Sentry, Segment and Datadog fail locally. Websites
  that use Firebase or similar services keep working.
- **One Little Arc.** Links reuse the existing Little Arc window instead of opening
  a new one each time.
- **Lighter.** State files are written as compact JSON, LaunchDarkly starts offline
  and some background telemetry is turned off.
- **Agent browser tools.** A local MCP server gives each coding agent its own isolated
  background browser. See [Agent browser tools](#agent-browser-tools).
- **Separate data.** ArcMod keeps everything in `~/Library/Application Support/ArcMod`.
  An `ARC MOD` marker in the sidebar shows which browser you're in.

## What you give up

- Arc account features: sync across devices, Arc Max AI features, and calendar and
  email previews.
- iCloud, passkeys and push notifications. The copy is re-signed on your Mac, and
  Apple ties those features to Arc's original signature.
- Automatic updates. ArcMod never updates itself.

## Requirements

- An Apple Silicon Mac with Xcode Command Line Tools (`xcode-select --install`)
- [Bun](https://bun.sh) and [Git LFS](https://git-lfs.com)
- Arc **1.168.0 (88413)**. A copy is included in `bin/`, so it doesn't need to be
  installed.

> **Arc version:** the patches only match Arc 1.168.0, and the build refuses any other
> version. Arc updated itself to 1.169.0 on October 15, 2026, so this repo includes
> Arc 1.168.0 to build from. Porting to the latest release is next on the list.

## Quick start

```sh
git lfs install
git clone https://github.com/CryogenicPlanet/arc.git
cd arc
bun install

# Unpack the included Arc 1.168.0 and build ArcMod from it
mkdir -p build/source
tar -xJf bin/Arc-1.168.0-88413.app.tar.xz -C build/source
bun tools/build-mod.ts --source "$PWD/build/source/Arc.app"

tools/run-mod.sh   # launches ArcMod
```

If `/Applications/Arc.app` is already 1.168.0, skip the unpack step and run
`bun tools/build-mod.ts` without `--source`. Quit ArcMod before rebuilding, and
rebuild after pulling changes.

Always start ArcMod with `tools/run-mod.sh`; it applies the service blocking that
Chromium needs at launch.

The clone downloads about 730 MB through Git LFS: about 380 MB of Arc files in `bin/`
and about 350 MB of reverse-engineering files. To skip the latter, clone with
`GIT_LFS_SKIP_SMUDGE=1`, then run `git lfs pull --include="bin/*"`.

## Bring your logins over

ArcMod starts with an empty profile. To keep your sites signed in, copy your normal
Arc profile into it. Quit both browsers first, then run:

```sh
bun tools/import-arc-data.ts
```

This copies cookies, site storage, extensions, history and permissions. Sidebar
spaces and Arc account data aren't copied.

- macOS asks to read "Arc Safe Storage". Choose **Allow**, not "Always Allow".
- Your Arc data is only read. ArcMod's previous profile is kept as
  `Default.pre-import-<timestamp>`.
- ArcMod uses Chromium's mock keychain, so imported logins are protected only by a
  public key. Don't import on a shared Mac.

## Agent browser tools

`tools/agent-mcp.ts` is a local stdio MCP server. Register it with your client, for
example Codex:

```sh
codex mcp add arcmod -- /absolute/path/to/bun /absolute/path/to/arc/tools/agent-mcp.ts
```

Call `open_session` to get a fresh background browser with its own profile, then use
`open_tab`, `read_page`, `click`, `type`, `navigate`, `screenshot` and `wait_for`.
Agent browsers don't take focus or touch your own ArcMod windows.
[computer-use-tools.md](notes/computer-use-tools.md) covers every tool and its limits.

## Status and known issues

- Restarting doesn't yet reopen your previous windows automatically.
- All 162 menu actions and their shortcuts are covered by checks. Not every
  combination has been tested by hand.
- It's pinned to Arc 1.168.0 (see [Requirements](#requirements)).

[runtime-status.md](notes/runtime-status.md) has the current, detailed status.

## How it works

`bun tools/build-mod.ts` makes an APFS clone of Arc 1.168.0 (`/Applications/Arc.app`,
or the `--source` you pass), which takes no extra disk space. It then:

1. Gives the copy its own bundle ID and name, so its data folder and settings are
   separate from Arc's.
2. Applies small, fingerprinted patches to Arc's Swift app layer. The patcher refuses
   to run if the bytes don't match Arc 1.168.0 exactly.
3. Injects `ArcMod.dylib`, an Objective-C module that filters service requests and
   enables local menu actions.
4. Re-signs the copy ad hoc.

The Chromium engine is unchanged. [local-mode.md](notes/local-mode.md) and the
[account-guard audit](notes/local-guard-audit.md) describe every patch.

## Development

```sh
bun run typecheck
bun run lint
bun run test
```

Binary tests run against `bin/Arc.arm64`, the original Arc 1.168.0 executable, stored
in Git LFS because Arc's auto-update replaces the installed copy. They skip when the
file is missing. The shortcut coverage step reads `/Applications/Arc.app` and fails
unless it's 1.168.0.

- `mods/`: the injected module and the service and shortcut policies
- `tools/`: build, patch, launch, import, agent and test scripts
- `resources/`: Arc metadata and policy definitions
- `bin/`: Arc 1.168.0's executable (for tests) and app bundle (for builds), in Git LFS
- `ghidra/`, `dump/`: Arc 1.168.0 decompile and symbol dumps (Git LFS); the analyzed
  Ghidra project stays local
- `notes/`: findings, runtime evidence and handoffs; start with
  [HANDOFF.md](notes/HANDOFF.md)

Coding agents working on this repo should read [AGENTS.md](AGENTS.md) first.
