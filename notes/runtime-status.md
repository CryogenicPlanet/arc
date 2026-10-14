# ArcMod runtime checkpoint — 2026-10-13

Target: Arc 1.168.0 (88413), arm64. The initial Git commit records this checkpoint,
including known failures. It is not a known-good shortcut baseline.

## Implemented and checked

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
  paths, preserved service checks and validation limits. Direct sidebar close controls
  and the complete shortcut inventory still need further live coverage.
- Automatic startup restoration still opened a fresh window during restart testing.
  This remains a separate unresolved behavior after removing the confirmed account
  gate; upstream encoding/dispatch did not expose another account rejection.
- The static inventory contains 89 native NIB bindings. It is an inventory, not
  evidence that every shortcut has passed live testing.

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
