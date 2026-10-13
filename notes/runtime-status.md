# ArcMod runtime checkpoint — 2026-10-13

Target: Arc 1.168.0 (88413), arm64. The initial Git commit records this checkpoint,
including known failures. It is not a known-good shortcut baseline.

## Implemented and checked

- Local browsing without an account, vendor service filtering, separate ArcMod data,
  the bottom `ARC MOD` marker and reuse of one Little Arc are implemented. Details
  and earlier runtime evidence are in `local-mode.md`.
- Cmd+T opens the native command bar. Its nil-session path now cleans up the native
  state snapshot before continuing to the local action.
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

## Open regressions

- Cmd+W and the sidebar close control do not reliably close disposable unpinned tabs.
  The native close action and close reducer are reached. The local menu classifier
  accepts Cmd+W, so menu enablement alone does not fix the failure. Native selected
  sidebar IDs and focused content associations are under investigation.
- The user reports Cmd+[ and Cmd+] failing. History must be verified alongside
  tab closing before claiming the shortcut audit is complete.
- The static inventory contains 89 native NIB bindings. It is an inventory, not
  evidence that every shortcut has passed live testing.

## Validation boundaries

Typecheck, lint, ten Bun binary tests, native service-policy tests and native shortcut
policy tests passed before this checkpoint. Build signing passed before launch.
Do not describe those checks as proof of live tab closing or history behavior.

The back-forward-cache experiment did not produce persisted page restoration; no
bfcache change is retained. Command-bar captures used different workloads and cannot
be compared as a measured speedup. Raw profiles and browser data remain local and
are ignored by Git.
