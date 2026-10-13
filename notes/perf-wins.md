# Perf wins in Arc's Swift layer (Arc 1.168.0)

Survey of 2026-10-12 (evening). Combines the Ghidra decompile with live measurements of the stock
Arc (pid 55729) while the user was away. This survey is historical; the current applied
changes and validation limits are recorded in `runtime-status.md`. Addresses are Ghidra addresses
(image base `0x100000000`); `sample` offsets are `addr - 0x100000000`.

## What was measured

| Measurement | Result | Evidence |
|---|---|---|
| Main thread while idle | ~0% busy (semaphore/mach_msg waits) | `profiles/arc-idle.sample.txt`, `profiles/2026-10-13T05-31-07-312Z.sample.txt` |
| Where the Storable save runs | Swift-concurrency task → `OS_dispatch_queue.sync` on the store's own queue (`DispatchQoS.background`) | `profiles/2026-10-12T23-09-storable-save-window.sample.txt` line ~3203 |
| CPU cost of encoding `StorableSidebar.json` | ≈9 ms (9 samples at 1 ms), on the background queue, **not** the main thread | same file |
| Save cadence while idle | 23:07:58, 23:09:04, 23:10:11, 23:10:15 (sidebar + windows saved together) | file mtimes, watch script |
| What changed between the 23:10:11 and 23:10:15 saves | Only the element order of `firebaseSyncState.syncData.spaceModels[*].value.containerIDs` (5 spaces × 4 elements). `StorableWindows.json`: nothing | semantic JSON diff |
| Firebase during the save window | A Firestore transaction in flight (`-[FIRTransaction getDocument:error:]` semaphore waits, `FirebaseSidebarSyncClientImpl` frames 0x1015ad714 / 0x1015bd068 / 0x1015d5dd4, plus a `JSONEncoder` call for the publish payload) | same sample, thread at line ~3100 |
| Per-event path | `-[BrowserApp sendEvent:]` → FUN_1001066ec (sets `isHandlingSendEvent`, calls super). `nextEventMatchingMask:` → FUN_100106e28 (Date bridge, super). `InstrumentedBrowserApp` methods are pure `super` calls | `ghidra/decomp/0x1001.c`, `0x102e.c` |

Pretty-print overhead of the stores that are decoded at launch or rewritten at runtime:

| File | On disk | Compact | Ratio |
|---|---|---|---|
| StorableSidebar.json | 410 KB | 238 KB | 1.72× |
| StorableArchiveItems.json | 1079 KB | 728 KB | 1.48× |
| StorableCommandBarAdditionalRanking.json | 223 KB | 120 KB | 1.85× |
| StorableLiveData.json | 72 KB | 34 KB | 2.12× |
| StorableWindows.json | 2 KB | 1 KB | 1.45× |

## Corrections to earlier notes

- The sidebar/windows save is **not a fixed 60 s timer**. It is change-triggered (saves 4 s apart were
  observed) and the two files are written by one effect (`SharedAppFeature.CancelID.windowsAndSidebar`).
- The save does **not** block the main thread. The "once-a-minute hitch" hypothesis is not supported by
  the data; drop it as a UI lever. It remains an IO/CPU churn lever.

## Wins, ranked by confidence × impact

### 1. Compact JSON for every Storable store (one 4-byte patch)

`Storable.StorableDataStoreImpl.init` (FUN_100dab1c4, `ghidra/decomp/0x100d.c:138067`) does
`jsonEncoder.outputFormatting = .prettyPrinted` for every store. The call site:

```
0x100dab528  bl  0x1035a2638   ; stub → $s10Foundation11JSONEncoderC16OutputFormattingV13prettyPrintedAEvgZ
0x100dab530  bl  0x1035a265c   ; stub → JSONEncoder.outputFormatting.setter
```

File offset in the arm64 slice = `0xdab528` (`__TEXT` fileoff 0). Bytes there are `44 dc 9f 94`.
Replace with `1f 01 00 f9` (`str xzr, [x8]`). Foundation returns this resilient value
through the indirect result address in `x8`; the earlier `mov x0, #0` recipe was incorrect.
The native ABI probe in `tools/verify-foundation-abi.swift` checks its representation.
`JSONDecoder` reads either form and backups remain readable. This patch is now applied
by `tools/patch-local-mode.ts` before signing. The measured storage surrogate result
and limits are recorded in `runtime-status.md`.

### 2. Stop the idle rewrite + Firestore publish loop

With the user away, the sidebar store was re-encoded and rewritten roughly once a minute and a
Firestore transaction ran alongside. Two independent dirtiers were identified:

- **Automatic live folders** (GitHub): `automatic-live-folders-min-refresh-interval-in-seconds = 120`
  (live LaunchDarkly value). The fetch result is stored *inside* the sidebar item
  (`automaticLiveFolderData.lastFetch.timestamp`, seen changing in the 23:07→23:10 diff), so every
  refresh dirties the whole sidebar document. Levers: `hasTurnedOffGithubLiveFolder` defaults key,
  or flag override `automatic-live-folders-enabled=false`.
- **Firebase sidebar sync** publish/ack state (`firebaseSyncState.lastSyncedTimestamp`,
  `publishInProgress`, and `SpaceModel.containerIDs`, a `Dictionary<ContainerType, Identifier>`
  encoded as an alternating array whose order is not stable between encodes; `swift-types:24601`).
  Lever: `firebaseSyncEnabled=false` (the mod already sets it). On stock Arc this is a user choice.

Expected effect: no periodic 410 KB encode/write and no Firestore round-trips while idle; on battery this
also matters for the radio.

### 3. Flag overrides, now with confirmed live values

Decoded from the LaunchDarkly cache (`dump/launchdarkly-flags.xml`, 852 flags; decoder snippet in
the session notes below). Override route: `-transientFeatureFlagOverrides 'a=false|b=false'`.

| Flag | Live | Set to | Why |
|---|---|---|---|
| `disable-back-forward-cache` | true | false | Chromium bfcache is off → Back/Forward reloads pages. Biggest UX win per keystroke; verify against `backForwardCacheEnabled` defaults key |
| `composable-architecture-tracing-in-chromium-enabled` | true | false | Every TCA action goes through `_SignpostReducer` → `TelemetryClient.TracingBackendManager` (NSLock, `Set<TracingSpanInstance>`, `LockIsolated` span dictionary) → `ADKClient.ADKTracingBackend` (another `LockIsolated` dictionary) into Chromium tracing. Pure overhead unless someone records a trace |
| `windows-layout-cycle-tracing-enabled` | true | false | Same tracing machinery on window layout |
| `sidebar-snapshot-analytics-enabled` | true | false | `TablistViewController.SidebarSnapshotViewState` snapshots for analytics |
| `lifetime-violations-reporting-enabled` | true | false | `LifetimeTracker` keeps a weak `Box` per tracked object under an `NSRecursiveLock`, holds a copy of `SidebarData` (`Models.sidebarState`) and re-verifies on a signal. Debug tooling in release |
| `memory-usage-event-sampling` | 0.05 | 0 | Memory sampling events |
| `record-chromium-crash-keys-in-sentry` | true | false | Sentry crash-key writes |
| `analytics-interaction-instrumentation-client-enabled` | true | false | Already sampled at 0.75% of release sessions (`analytics-interaction-metrics-sampling-config`), so small |
| `automatic-live-folders-enabled` | true | false | See win 2 |
| `sidebar-sync-favicons-enabled` | true | false | Favicon cache writes (`SidebarItemsFaviconCache/` churned at 23:06:31) |

Already off, no action: `command-bar-animation-enabled`, `fullscreen-animations-enabled`,
`tab-perceived-performance-enabled`, `sentry-*` sampling (0), `datadog` logging. Tab freezing is on
(`high-cpu-usage-while-in-background-freezing-enabled`, `trim-memory-on-freeze`,
`use-arc-core-freezing-implementation`); leave it.

### 4. Launch-time decode

Decoded at launch from pretty-printed JSON: archive items 1.08 MB (2,398 items), sidebar 410 KB,
command-bar ranking 223 KB (`CommandBarAdditionalRankingData`: recently-switched tabs, query →
archetype, type-travel usage, per profile), live data 72 KB, 22 dated backups per store listed via
`contentsOfDirectory`. Win 1 cuts the parse bytes by ~35%. Further levers: a shorter
`autoArchiveTimeThreshold`, and the `allow-disable-archive` flag (exists, value false). Measure with a
launch profile of `build/ArcMod.app` before and after.

### 5. Negative results (no win here)

- `BrowserApp` / `InstrumentedBrowserApp` event entry points are pass-through; no per-event cost to remove.
- `ARCUI.HoverRegionTracker` only notifies its delegate on region-state changes (per-region
  `HoverRecord` with `lastUpdateToken`), not on every mouse move. The sidebar-hover→root-state concern
  from `perf-levers.md` is still plausible (`WindowHoverTracker` sends `WindowAction`s into the window
  store) but needs an interaction profile to quantify.
- Save/encode is already off the main thread (see above).

## Still needs an interaction profile

Run this while using Arc for 20 s (switch spaces, hover the sidebar, open the command bar, scroll):

```
bun tools/profile-arc.ts 20 --delay 5
```

Questions it should answer: cost of TCA `ViewStore` dedupe with the 104-field `Arc.WindowState`,
how many actions a sidebar hover produces, and what the command bar does per keystroke
(`StorableCommandBarAdditionalRanking` suggests ranking state is persisted after use).

## Tooling added

- `tools/symbolize.ts` — map `sample` offsets or Ghidra addresses to function names and the decompile shard.
- LaunchDarkly cache decoder (inline):

```
bun -e 'import {readFileSync} from "fs"; const x=readFileSync("dump/launchdarkly-flags.xml","utf8");
for (const m of x.matchAll(/<key>(flags-[^<]*)<\/key>\s*<data>([\s\S]*?)<\/data>/g)) {
  const j=JSON.parse(Buffer.from(m[2].replace(/\s/g,""),"base64").toString());
  for (const [k,v] of Object.entries(j.flags)) console.log(k,"=",JSON.stringify(v.item?.value)); }'
```
