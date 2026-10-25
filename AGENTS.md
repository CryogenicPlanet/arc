# Working on ArcMod

## Context

- Read `README.md`, the status issue (https://github.com/CryogenicPlanet/arc/issues/1), `notes/runtime-status.md`,
  and relevant sections of `notes/HANDOFF.md` before changing behavior. The status issue
  and runtime status take precedence over older survey notes.
- Target Arc **1.168.0 (88413), arm64**. Keep changes in the native app layer.
  ArcMod runs on Arc's own engine by default; our engine is the `engine/`
  submodule ([Arc Engine](https://github.com/CryogenicPlanet/arc-engine)), which has
  its own `AGENTS.md`.
- Preserve local account-free behavior and service filtering. This `no-login`
  branch carries only those changes; other features belong on `master`.
  Follow Arc's native design for UI changes.

## Workflow

- Delegate meaningful discovery/review work to read-only subagents. Give each a
  clear scope; keep one writer in the shared checkout.
- Keep patches narrow and fingerprinted. Preserve native ownership, calling
  conventions, register state and valid state checks. Resolve local feature guards
  at their call sites rather than changing global authentication getters.
- Keep source changes and fixes in focused Git commits. Get a fresh review for
  meaningful native changes before committing.
- For shared coordination, fetch `https://chirp.cryo.wtf/init` at session start and
  follow the live protocol. The lead owns board writes and credentials; Codex state
  is exclusively in `~/.chirp/codex/`. Subagents report through the lead.

## Build and verification

- Quit ArcMod before `bun tools/build-mod.ts`; the builder replaces its app bundle.
- The everyday ArcMod is the user's own browser, installed at `/Applications/ArcMod.app`; don't
  rebuild or relaunch it without asking. Test with `--validation` builds (or agent builds on
  `master`); `bun tools/build-mod.ts --debug` and `tools/run-mod.sh --debug` keep a build in
  `build/` instead. When launching a build by hand, pass `--use-mock-keychain` (or use
  `tools/run-mod.sh`) so a failed in-app switch hook can't make macOS ask for "Arc Safe Storage".
- For code changes, run `bun run typecheck`, `bun run lint`, and `bun run test`.
  Ensure `bin/Arc.arm64` exists so binary tests do not silently skip; see README.
- Native patches also need a rebuilt, signed app and relevant live behavior checks.
  Use disposable localhost tabs and preserve user tabs and data.
- Keep `/Applications/Arc.app` and the original Arc profile untouched. Do not commit
  browser data, credentials, app bundles or profiling captures. The 1.168.0
  decompile, dumps, executable and app bundle are tracked with Git LFS; the Ghidra
  project stays local.
- When you find or fix a problem, update the status issue's list of known problems
  (`gh issue edit 1 -R CryogenicPlanet/arc --body-file <file>`, keeping its layout and the
  "Updated" date); don't keep separate status lists in docs. Record findings, evidence and
  validation limits in `notes/`. Passing binary tests
  does not prove every shortcut works; separate source checks from live results.
