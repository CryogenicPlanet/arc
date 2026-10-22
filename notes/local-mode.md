# Local mode

Implemented for Arc 1.168.0 (88413), arm64, on 2026-10-12.

`bun tools/build-mod.ts` builds the independent `build/ArcMod.app`. `tools/run-mod.sh`
launches it through LaunchServices, preserving Chromium's normal sandbox. The module
is a required dylib load, so a missing module cannot silently produce a partially modded app.

## Changes

- Account onboarding no longer opens. Normal windows and external URLs are allowed
  with no account session. No Firebase identity/token or fake AuthSession is created.
- CloudKit, Firebase sync, Arc Max integrations, account previews and usage sharing are
  disabled in the mod's own defaults. Native NSURLSession requests and DNS lookups to
  the configured service hosts fail locally. Chromium's resolver rules only include
  Browser Company hosts, preserving shared Firebase services used by ordinary websites.
- A finite allowlist permits local window/tab/command-bar/close/preferences commands
  despite the absent account. Native validation still runs first. Other commands retain
  their original validation and state checks.

## Native patches

`tools/patch-local-mode.ts` checks the surrounding bytes, maps virtual addresses through
file-backed Mach-O segments, and refuses unfamiliar versions. It is idempotent and only
accepts the ArcMod or validation executable under `build/`.

| Site | Change |
| --- | --- |
| `0x10186b3ec` | Store false in UnboxingManager's presentation view state |
| `0x102a75744` | Destroy the temporary optional session, then enter local window creation |
| `0x1001af800` | After optional-session cleanup, enter local external URL routing |

Actual account/session predicates are unchanged. ArcCore code is unpatched;
the copied app and its nested code are re-signed as before.

## Verification

`bun run test`, `bun run typecheck`, and `bun run lint` pass. Binary tests check exact
modified ranges, branch targets, input immutability, idempotency and mismatch rejection.
The compiled service test checks hostname boundaries, actual process DNS interposition,
allowed loopback resolution and a real NSURLSession request failing through the filter.

The separate validation bundle (`bun tools/build-mod.ts --validation`, then
`tools/run-mod.sh --validation`) uses `ArcModValidation` data and its own preferences.
Native UI checks on the full build proved normal browsing, New Tab and external URL
handling with no login. Account state was absent in the fresh validation profile; the
normal mod's existing auth store had a null session.

On 2026-10-22 this branch's validation build was rebuilt and launched. `/Applications/Arc.app`
had updated to 1.169.0, so the 1.168.0 source bundle was reassembled from `bin/Arc.arm64`,
the saved `resources/Info.plist` and an earlier 1.168.0 clone. The build signed and
verified, opened a local window with no account session, and loaded an external
localhost URL. Shortcut and Settings paths were not re-run live on this build.

Some SDKs remain bundled and retry requests that the native filter blocks; this is
service isolation, not removal of every SDK binary. Without `master`'s offline-startup
patch, LaunchDarkly retried about once every five seconds in the live check, at idle CPU.
Use the launcher for Chromium's additional vendor resolver rules. The native filter and
local preferences are also installed on direct app launch.

REA 6.4.0 inspected the original thin Mach-O; evidence is in
`build/evidence/rea-macho.json`. Its static dispatch operation rejected the 76 MiB input
against a 64 MiB budget, so existing Ghidra dumps and LLVM disassembly supplied the
precise native control-flow evidence.
