# Arc performance levers (Arc 1.168.0)

Read-only static survey, 2026-10-12. Nothing applied yet. Line numbers refer to `dump/swift-types.swift`.

## Feature flags: overridable without patching

Resolution: default → remote (LaunchDarkly) → **override** (`FeatureFlagValueSource`, line 44285). An override beats LaunchDarkly.

Override routes (found in the disassembly; none tested yet):
1. **`transientFeatureFlagOverrides`**: a defaults key / launch argument in `ARCFoundationModels.ArcUserDefaultSettings` (line 9753; the full enum of ~230 keys is at lines 9547–9844).
   The parser is `applyingTransientOverrides(launchArgument:)`. It splits on `|` (0x101482e50 / 0x101482f58), then on `=` (0x101483044); bad input logs "Incorrect feature flag override format".
   - One-shot: `open -a Arc --args -transientFeatureFlagOverrides 'flag-a=false|flag-b=0'`
   - Persistent: `defaults write company.thebrowser.Browser transientFeatureFlagOverrides -string '…'` (with Arc quit)
2. **`~/Library/Application Support/Arc/StorableFeatureFlags.json`**: `FeatureFlagsClientImpl.overridesDataStore` (line 44383), schema `{version, flags:[{id,value}]}` (line 44433). The file doesn't exist yet and the version number is unknown.
3. **Developer menu → `showFeatureFlagsWindow`** (import/export `feature-flags.json`). Gated by `DeveloperMenuAccessLevel {notAllowed, employee, qa}` (line 85395).
   The "qa" level is probably the flag `external-qa-access-for-developer-menu-enabled` (currently false); overriding it may unlock the menu (unverified).

Flag keys: ~200 desktop keys at `dump/strings.txt` lines 54560–54811. Live values: LaunchDarkly cache of 852 flags, copied to `dump/launchdarkly-flags.xml`.

## Levers, cheapest and safest first

1. **Turn off AI/background features** (Settings, or `defaults` with Arc quit):
   - Keys, all currently on: `hoverCardsEnabled`, `tidyTabsEnabled`, `renamePinnedTabsEnabled`, `renameDownloadsEnabled`, `gptSiteSearchEnabled`, `arcMaxAutoOptInEnabled`.
   - Also tab previews (`calendarPreviewEnabled`, `gmailPreviewEnabled`, `TabPreviews` line 64394), the GitHub live folder (refreshes every 120s), and the calendar preview (fetches every 360s).
   - Impact: fewer network calls on hover and in the background. Modest.
2. **macOS Reduce Motion**: Arc respects it (`ARCUI.AnimationRespectingReduceMotionModifier`, line 19554). The defaults key `fastAnimations` exists; its effect is unconfirmed.
3. **Flag overrides** (via route 1):
   - Low risk (turns off background reporting):
     - `sidebar-snapshot-analytics-enabled=false`
     - `analytics-interaction-instrumentation-client-enabled=false`
     - `lifetime-violations-reporting-enabled=false`
     - `record-chromium-crash-keys-in-sentry=false`
     - `memory-usage-event-sampling=0`
     - `composable-architecture-tracing-in-chromium-enabled=false`
     - `automatic-live-folders-enabled=false`
     - `sidebar-sync-favicons-enabled=false`
   - Experimental:
     - `disable-back-forward-cache=false`: Arc currently disables Chromium's back/forward cache, so this could make Back/Forward instant.
     - `lightweight-accessibility-mode=true`: may help if accessibility tools such as Raycast or window managers are running.
     - `use-metal-by-default=true`: currently false.
4. **Chromium knobs**:
   - Defaults keys ArcCore reads at startup: `chromiumDisabledFeatures` / `chromiumEnabledFeatures`, `disableSkiaGraphite`, `useMetalByDefault`, `disableCompositorRecycling`, `disableBackForwardCache`, `backForwardCacheEnabled`, `macCoalescedResizing`, `enablePageContentExtraction`.
   - Arc copies flag values into these (`ADKFeatureFlagsBridge.applyValuesToChromium`), so set the flag rather than writing defaults directly.
   - The current `chromiumDisabledFeatures=CATransactionV2` is deliberate; leave it.
   - arc://flags also works.
5. **Sync**: `firebaseSyncEnabled=1`. Turning sync off should stop the Firestore listener and its batching work (`TimeThrottlingConfig`, line 46674); this is a guess.
6. **Fewer windows and a smaller sidebar/archive**: see the persistence and state sections below; the impact is inferred.
7. **Telemetry host blocking**: helps privacy and network use, not UI speed. Telemetry is already throttled server-side:
   - Sentry trace sampling is 0 in release.
   - Datadog client logging is off.
   - Interaction metrics are sampled at 0.75% of sessions.

   Hosts: Sentry `o298668.ingest.sentry.io`; Datadog `browser-intake-datadoghq.com`; Segment `api.segment.io`, `cdn-settings.segment.com`; LaunchDarkly `clientstream.launchdarkly.com`, `mobile.launchdarkly.com`. Blocking LaunchDarkly freezes flags at their cached values.
8. **Binary patch**: the only way to change the 60-second save timer or remove SDK startup. Requires re-signing (loses keychain groups and CloudKit; Sparkle overwrites the patch).

## Persistence

- `StorableSidebar.json` (421 KB) and `StorableWindows.json` are **fully rewritten every 60 s**: file timestamps observed at 22:29:01, 22:30:01, 22:31:01, 22:32:01 (`notes/storable-mtimes.txt`).
- The sidebar file is pretty-printed (1.72× its compact size). 127 KB of it is `firebaseSyncState`, against 110 KB of actual sidebar data.
- Writer: `Storable.StorableDataStoreImpl` (line 25731) on its own queue; `BackupPolicy` at line 25701. Building the snapshot on the main actor is a suspected once-a-minute hitch; unconfirmed.
- 22 dated backups per store (9.2 MB for the sidebar). Disk space only.
- `StorableArchiveItems.json`: 1.1 MB, 2,398 items, decoded at launch.

## Biggest TCA state structs

| Struct | Fields | Line |
|---|---|---|
| `Arc.WindowState` | 104 | 3536 |
| `PersistedWindowState` | 85 | 3643 |
| `PreferencesFeature.State` | 79 | 64297 |
| `SidebarSpaceState` | 60 | 77799 |
| `WindowContentViewController.State` | 60 | 729 |
| `PersistedPreferencesState` | 59 | 64188 |
| `WindowContentViewController.ViewState` | 47 | 670 |
| `Arc.AppState` | 47 | 4649 |
| `TabCellState` | 37 | 3945 |
| `TopBarPanelViewState` | 35 | 5595 |

`WindowState` holds a copy of app-wide state in every window, plus the sidebar hover state. So mouse movement over the sidebar changes the root state, and the cost likely grows with window count. `AppState` also carries the full feature-flag collection.
