# ArcMod runtime status (`no-login`)

Known problems are listed in the [status issue](https://github.com/CryogenicPlanet/arc/issues/1). This file records what has been
checked, how, and the limits of each check.

Target: Arc 1.168.0 (88413), arm64. Most of this was verified on 2026-10-13; later
changes are listed first. It is not a known-good shortcut baseline.

## Since 2026-10-13

- `tools/import-arc-data.ts` copies a stock Arc profile's cookies, site storage,
  extensions, history and permissions into ArcMod (2026-10-22).
- `bun tools/build-mod.ts --engine <ArcCore.framework>` builds ArcMod on another engine,
  such as [Arc Engine](https://github.com/CryogenicPlanet/arc-engine), our engine built
  from Chromium (2026-10-23). Its status is in that repo's README and `NEXT.md`.

## Implemented and checked

- Full shortcut audit covers 162 NIB actions, 19 generated native window bindings,
  two generated alternates and dynamic Space selection. Eighteen omitted local
  selectors now pass the finite nil-session bridge while retaining native state
  checks. Normal ArcMod was rebuilt/signed; 72 live context/action checks cover
  editing, rich text/spelling, tab/window navigation, splits, pinning, browser tools
  and repaired local dialogs. Inventory drift and missing local/service routing
  fail tests/builds. See [shortcut-audit.md](shortcut-audit.md) for every case,
  generated command ownership, source fingerprints and live limits.
- Local browsing without an account, vendor service filtering and separate ArcMod
  data are implemented. Details and earlier runtime evidence are in `local-mode.md`.
  This `no-login` branch omits single Little Arc, compact Storable JSON, offline
  LaunchDarkly startup, telemetry defaults and the sidebar marker; they are on `master`.
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

Typecheck, lint, eleven Bun local-mode tests (ten binary), native service-policy tests and
native shortcut policy tests pass. The native ABI probe checks the CloudKit status value and the local
close fallback String representation. Build signing passed before launch. A fresh
read-only review verified bridge branches, register preservation, ownership and padding.
Do not describe those checks as proof that every shortcut works.

On this `no-login` branch, the live results above came from full builds that also carried
the dropped features. This branch's own validation build was rebuilt, signed and launched
on 2026-10-22 (see `local-mode.md`): it opened a local window and an external localhost
URL without an account. The shortcut matrix and Settings were not re-run on it.
`/Applications/Arc.app` has since updated to 1.169.0, so builds and the shortcut coverage
test need a 1.168.0 source bundle.

The back-forward-cache experiment did not produce persisted page restoration; no
bfcache change is retained. Command-bar captures used different workloads and cannot
be compared as a measured speedup. Raw profiles and browser data remain local and
are ignored by Git.
