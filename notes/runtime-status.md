# ArcMod runtime checkpoint — 2026-10-13

Target: Arc 1.168.0 (88413), arm64. The initial Git commit records this checkpoint,
including known failures. It is not a known-good shortcut baseline.

## Agent sessions

`--agent <slug>` creates separate app/data/preferences ownership and routes
external links and the Little Arc menu action to full browser windows. The local
`arcmod` stdio MCP adapter now exposes 15 browser/native tools, exclusive kernel
session leases, fresh page/element handles, accessible page state, trusted
background input, awaited navigation, explicit waits and inline screenshots.
Native UI inspection stays bound to the exact agent PID; badge AX labels and a
PID-bound native-readiness record are installed in new agent builds.

Two independent MCP clients passed concurrent localhost workflows, navigation,
async results, screenshot/native state, stale/foreign handle and competing CLI
checks with zero agent foreground observations in 240 samples. A cold-start crash
preceded the native-readiness barrier; two reruns passed after it. Source checks
and the full suite pass with stable Bun 1.4.3. See [computer-use-tools.md](computer-use-tools.md)
for setup, evidence and limits, and [agent-sessions.md](agent-sessions.md) for the
native/shared-state diagnosis. The MCP adapter is registered in local Codex
configuration; clients must load it. Computer Use itself still exposes native
apps, with no custom browser-provider adapter installed.

## Implemented and checked

- Full shortcut audit covers 162 NIB actions, 19 generated native window bindings,
  two generated alternates and dynamic Space selection. Eighteen omitted local
  selectors now pass the finite nil-session bridge while retaining native state
  checks. Normal ArcMod was rebuilt/signed; 72 live context/action checks cover
  editing, rich text/spelling, tab/window navigation, splits, pinning, browser tools
  and repaired local dialogs. Inventory drift and missing local/service routing
  fail tests/builds. See [shortcut-audit.md](shortcut-audit.md) for every case,
  generated command ownership, source fingerprints and live limits.
- Local browsing without an account, vendor service filtering, separate ArcMod data,
  the bottom `ARC MOD` marker and reuse of one Little Arc are implemented. Details
  and earlier runtime evidence are in `local-mode.md`.
- Cmd+T opens the native command bar. Its nil-session path now cleans up the native
  state snapshot before continuing to the local action.
- Cmd+L then Cmd+C now copies the selected URL. Arc's ordinary Edit → Copy item
  uses `copyAction:`, which was missing from the finite local shortcut policy.
  Admitting that wrapper preserves the existing validator continuation and native
  `copy:` responder dispatch; no binary patch or new hook was added. Rebuilt,
  signed normal ArcMod passed live full-URL and partial-selection clipboard checks,
  Edit → Copy was enabled, and Shift+Cmd+C still copied the full URL. With an empty
  selection the native command-bar path produced an empty clipboard; this change
  does not add new empty-selection semantics. Native policy tests also retain
  unavailable-service binding precedence for the new selector.
- Cmd+, opens Settings. Shortcuts and Profiles load, and Settings can be closed and
  reopened. The crash report traced the previous failure to eager CloudKit account
  status access; the local patch supplies `couldNotDetermine` to the existing reducer.
- Storable JSON encoding is compact. The indirect Foundation result is initialized
  through `x8`, verified by a native ABI probe. A read-only Codable surrogate measured
  36.7% fewer bytes across five captured stores; this does not establish an overall
  browser speedup. Existing data is rewritten through ordinary native saves.
- LaunchDarkly starts offline. No LaunchDarkly requests appeared after startup in
  the measured mod runs. Other blocked SDKs can still retry locally.
- Six verified telemetry defaults are disabled while preserving unrelated overrides.
- The finite local shortcut classifier and native menu-validation bridge are
  implemented and covered by native and binary tests.
- Cmd+W removes loaded disposable unpinned tabs, and Cmd+Shift+T restores the closed
  tab. The shared close helper previously rejected nil `currentUserID` derived from
  `WindowsState.authSession`. A scoped bridge at `0x102a3ade8` supplies a native small
  String only for that presence check, then resumes `0x102a3adec`. It preserves existing
  nonnil IDs and leaves global account getters unchanged. The helper only releases
  the fallback; it does not persist it or use it as an archive owner.
- Cmd+[ and Cmd+] navigated between local fixture pages in the current mod. Back also
  worked immediately after a failed close in the earlier build. No history patch was
  needed for these checks.
- The account requirement in the native saved-session restoration action is removed
  at `0x102ab2f48`, after state destruction. Saved-data checks and global authentication
  getters remain intact. This passes binary tests and fresh review; automatic startup
  restoration is not established by the current runtime checks.

## Open regressions

- The bounded account-guard audit is complete; see `local-guard-audit.md` for exact
  paths and preserved service checks. The complete shortcut inventory and priority
  live matrix are recorded in `shortcut-audit.md`; destructive commands and every
  possible profile/Space/modal combination remain outside live verification.
- Automatic startup restoration still opened a fresh window during restart testing.
  This remains a separate unresolved behavior after removing the confirmed account
  gate; upstream encoding/dispatch did not expose another account rejection.
- The initial Rename Space menu attempt after a rebuild was a transient no-op.
  Subsequent command-bar/menu checks and a fresh-launch first-dialog retest passed.
  No further account guard was found; the initial transient cause is unproven.

## Validation boundaries

Typecheck, lint, twelve Bun binary tests, native service-policy tests and native shortcut
policy tests pass. The native ABI probe checks both Foundation formatting and the local
close fallback String representation. Build signing passed before launch. A fresh
read-only review verified bridge branches, register preservation, ownership and padding.
Do not describe those checks as proof that every shortcut works.

The back-forward-cache experiment did not produce persisted page restoration; no
bfcache change is retained. Command-bar captures used different workloads and cannot
be compared as a measured speedup. Raw profiles and browser data remain local and
are ignored by Git.
