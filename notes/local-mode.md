# Local mode and single Little Arc

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
- The requested `ARC MOD` marker is anchored at the bottom of the native sidebar.
  The user accepted the current marker but wants future UI changes to match Arc's style.
- One Little Arc (Settings → ArcMod, on by default): new Little Arc requests reuse the
  existing Little Arc regardless of hostname or entry point, retaining Arc's native
  navigation and focus behavior. A native profile replacement closes the previous Little Arc
  through Arc's existing close/lifecycle implementation; main browser windows are excluded.
  With the setting off, Arc's own same-site check runs and links open a Little Arc per site.
  The decision at `0x102a7cb60` branches to a bridge at `0x104153e00`, in the zero padding at
  the end of `__TEXT` (after `__eh_frame`, inside the file-backed, signed, executable segment).
  The bridge calls `getenv("ARCMOD_LITTLE_ARC_PER_LINK")`, which the dylib sets on the main
  thread at load and on toggle, then runs either ArcMod's replacement or Arc's original six
  instructions. Clobbering caller-saved registers and flags there is safe: the site follows
  `bl; cmp; b.ne`, so x0–x17 and the flags are already dead, and both continuations
  (0x102a7cb78: `mov x0,#0; bl`; 0x102a7cbe0: reads only w8) redefine what they read; x30 was
  saved in the prologue and sp is untouched. Validated live on the validation build: one reused
  Little Arc by default, separate per-site windows with the setting off. The variable is
  inherited by child processes (harmless), and a toggle could race a thread copying `environ`
  (only at the moment of toggling).

## Native patches

`tools/patch-local-mode.ts` checks the surrounding bytes, maps virtual addresses through
file-backed Mach-O segments, and refuses unfamiliar versions. It is idempotent and only
accepts the ArcMod or validation executable under `build/`.

| Site | Change |
| --- | --- |
| `0x10186b3ec` | Store false in UnboxingManager's presentation view state |
| `0x102a75744` | Destroy the temporary optional session, then enter local window creation |
| `0x102a7cb60` | Keep the Little Arc type check; accept any existing Little Arc |
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
Native UI checks proved normal browsing, New Tab, external URL handling, repeated
different-host links and a rapid burst replacing content in the same Little Arc ID.
Closing Little Arc left the main window intact, and the next link created one new
Little Arc. Restart again opened an external URL in one Little Arc with no login.
The native diagnostic recorded one visible Little Arc. Account state was absent in
the fresh validation profile; the normal mod's existing auth store had a null session.

Cross-profile replacement has static lifecycle review but has not been exercised with
multiple validation profiles. Some SDKs remain bundled and retry requests that the
native filter blocks; this is service isolation, not removal of every SDK binary.
Use the launcher for Chromium's additional vendor resolver rules. The native filter and
local preferences are also installed on direct app launch.

REA 6.4.0 inspected the original thin Mach-O; evidence is in
`build/evidence/rea-macho.json`. Its static dispatch operation rejected the 76 MiB input
against a 64 MiB budget, so existing Ghidra dumps and LLVM disassembly supplied the
precise native control-flow evidence.
