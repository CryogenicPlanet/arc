# Engine milestone 1: launch-slice runtime baseline

**Status:** proposed 2026-10-23, revised after an independent gpt-6.1-sol/high review; not started. Needs Rahul's go-ahead.

## The milestone in one paragraph

Run the app on the real Arc engine through one short, fixed scenario: launch, open a page, navigate, store data, close a tab, quit, relaunch, check the data, and quit again. Every step is scored pass, fail or inconclusive against fixed expected values. Alongside the steps, record three things:
- which Arc engine methods and app callback implementations are entered in the browser process;
- the first thread and step each one is entered on;
- the helper processes, how they are signed, and whether they exit.

No engine code is written. The output is a reusable pass/fail harness and a **lower bound** of the interface the app uses on this path. It is not the full contract a replacement must provide.

## Why this milestone, and why now

The reviewed research ([engine-feasibility.md](engine-feasibility.md), [spec index](../../arc-engine/specs/README.md)) is static. It inventories 146 classes, 1,964 declared methods and 26 protocols. It also states what static work cannot settle:

- "No complete dynamic reachable set has been measured." ([report:44](engine-feasibility.md)) Declared methods are not methods that are actually used, and a selector send does not identify its receiver.
- Callback order, threading, cardinality and teardown remain open for most protocol identities.
- "The saved equality runner has no correctness assertions: equal outputs, including equal errors, can be reported as matching." ([report:230](engine-feasibility.md))
- Helper launch, signing and Aperitif behavior are "launch-critical work, not optional polish", and none were observed ([report:226](engine-feasibility.md)).

The report's staged plan puts a provenance-rich native baseline (stage 3) before any route prototype or launch-only vertical slice (stages 4–5). Stage 5 also needs new authorization. This milestone is stage 3, cut down to the stage-5 scenario: "pristine old app starts, creates a profile and native pane, navigates, tears down and restarts with asserted state and clean process lifetime".

It gives the stage-5 decision two concrete inputs:
- a harness that judges any engine on asserted outcomes;
- the observed entries on this path.

The report warns that "native context service state is constructed before lazily cached ObjC service wrappers" ([report:72](engine-feasibility.md)). So the observed entries are a starting point for scoping, not a list of what can be left out.

What this milestone does not do:
- It writes no engine code and builds no `ArcCore.framework`.
- It runs no CEF prototype.
- It does not rerun or extend the static research pilot.
- It uses no VM: `arcmod-engine` stays paused and `arcmod-research` isn't needed.
- It does not touch a real profile, passkeys or accounts.

## Configuration under test

| | |
|---|---|
| App layer | ArcModAgent build of Arc 1.168.0 (88413) from `tools/build-mod.ts --agent`, at a recorded ArcMod commit and patch manifest. Pristine source executable pin `4c03750e…682`. |
| Engine | ArcCore **1.170.0** (Chromium 156.0.8078.48). Its pristine arm64 slice pin is `69276ada…3dd`. The builder re-signs it ad hoc, so the runtime file has its own hash. G1 records both. |
| Address source | `specs/methods.tsv` `imp_va`: unslid 1.170.0 VAs, 1,566 distinct IMPs, 120 of them shared by 518 rows. App callbacks come from [`app-contract-joins.tsv`](../../arc-engine/research/2026-10-22-sol/evidence/agents/protocols/initial/evidence/app-contract-joins.tsv): 270 implementations in 18 adopter classes. |

This is a single configuration on purpose. The app's native pairing with ArcCore 1.168.0 would only show differences in the hybrid, and C1 doesn't need it. It's a possible follow-up, using the complete 1,964-row [`engine168-implementations.tsv`](../../arc-engine/research/2026-10-22-sol/evidence/agents/protocols/initial/evidence/engine168-implementations.tsv): 1,564 distinct IMPs, 121 shared by 521 rows.

The app layer is ArcMod's: account-free, with service filtering. It is not the Developer ID–signed pristine app, which would use the original Arc profile and identity; the repo rules forbid that. Two recorded limits follow:
- An account-free app can make different engine calls from a signed-in pristine app.
- The stage-5 wording "pristine old app" stays an open acceptance gap.

## Launch mechanism

Traced runs need lldb to start the browser process, so the process is launched directly instead of through LaunchServices.
- **Direct-exec runs (traced and untraced alike):** the agent build's executable, launched with the same arguments and environment `tools/run-mod.sh --agent <slug> --cdp-port <port>` produces. That includes its `defaults write` of the mod's own preference domain. `--no-sandbox` is **not** added; Chromium's sandbox stays on.
- **One LaunchServices run** through `run-mod.sh`. Its step outcomes must match the direct-exec untraced runs, and any difference is reported.

## Scenario

One fresh agent data directory per run, reused for the relaunch at S7. Fixtures are served on `127.0.0.1`. Each fixture's expected values are frozen in one file in the harness: titles, DOM markers, a solid colour block with its RGB value, cookie attributes, storage keys and values, and deadlines.

| Step | Action | Asserted outcome |
|---|---|---|
| S1 | Cold launch on the empty data dir | Agent native-readiness record appears within 30 s; CDP lists exactly one page target |
| S2 | Open fixture A | Expected `document.title` and DOM marker; the screenshot's centre pixel matches the fixture's colour block within ±8 per channel |
| S3 | Navigate to fixture B (cross-document), then `#frag` (same-document), then Back | `location.href`/`title` after each action equal the frozen list |
| S4 | Set a persistent cookie (`Max-Age=86400`), a localStorage key and an IndexedDB record | Same-session readback equals the frozen values |
| S5 | Close the tab, open a new tab on fixture A | S2 assertions hold again |
| S6 | Quit through the app's normal quit | Browser and every observed helper exit within 15 s; no new crash report |
| S7 | Relaunch on the same data dir | The profile directory set is unchanged (no new profile dir); S4 values read back unchanged |
| S8 | Quit | Same as S6 |

S7 asserts storage persistence, not tab restoration. Automatic startup restoration is a known open ArcMod regression ([runtime-status.md](runtime-status.md)). S7 records which window opened and nothing more.

Timeouts produce `inconclusive`, never `pass`. A step passes only on its own frozen expected values.

## Observation channels

1. **Assertions** run over CDP with the existing agent tools (`tools/agent-cdp.ts`).
2. **Engine-entry trace:** browser process only, using module-qualified address breakpoints in ArcCore.
   - **Arming.** Breakpoints are set before launch and resolved when the image loads, before its initializers run. The planted address is the slide plus the unslid VA. Before planting, the tracer reads the original bytes at each address.
   - **Selector check.** At each entry, `x1` is read as a C string and checked against the selector names in the metadata. A mismatch, or an unreadable `x1`, is recorded as `imp_only` with the reason.
   - **Unique IMPs (1,446).** The IMP itself identifies the metadata row, by membership. A matching `x1` confirms it. The breakpoint stays armed until the first confirmed entry or 20 hits, whichever comes first.
   - **Shared IMPs (120).** The tracer finds the receiver's class from `x0` using memory reads only, never by running code in the target.
     - Isa decoding: the raw or non-pointer isa is decoded with masks read from the loaded libobjc (`objc_debug_isa_class_mask` and related).
     - Tagged-pointer receivers are rejected.
     - For the 16 class methods, `x0` is a class, so its isa is the metaclass.
     - Subclasses (Swift, KVO) are handled by walking the verified superclass chain to the declaring owner. The receiver class and the declaring owner are recorded separately.
     - Each distinct (owner, selector) pair is recorded. The breakpoint disables after 200 hits and is marked `capped`.
   - **Recorded per identity:** first confirmed entry, its thread (main or not, and name), its scenario step and its debugger-ordered rank. Later calls are not recorded. Repeated-call order, cardinality and argument values need separate instrumentation and are out of scope.
3. **App-callback trace:** the same procedure applied to the 270 `app_imp` addresses in `app-contract-joins.tsv`, with the app's own metadata.
4. **Process and helper record:**
   - The harness polls the browser's child processes every 100 ms, identified by PID and start time.
   - For each process it records the executable path, runtime SHA-256, architecture, codesign identity, flags and entitlements, Chromium `--type`/sub-type, whether `libaperitif.dylib` was mapped at the first sample (`vmmap`), and the exit time.
   - Recorded limit: a process that lives less than one polling interval can be missed. Mapping at sample time says nothing about load order.
5. **Network audit,** with a stated boundary.
   - A Chromium NetLog (`--log-net-log`) for every run. The report lists every non-loopback destination that Chromium's network stack used.
   - App-layer (NSURLSession) traffic falls outside NetLog. The only app-layer evidence is ArcMod's service-policy log of blocked hostnames, and the report says so.
6. **Logs and crashes:** app stdout/stderr, the lldb transcript, and `~/Library/Logs/DiagnosticReports` entries since run start for the app and helper names.
7. **Write audit:** before and after each run, a recursive listing with size, mtime and **ctime** of the protected paths, plus content hashes of their key files. Any write updates ctime, and user-space tools can't set it back.
   - Protected paths: `/Applications/Arc.app`, `~/Library/Application Support/Arc`, the normal ArcMod data dir, and their preference domains.

## Acceptance gates

Milestone 1 is done when all gates pass. A failed gate gets reported with its evidence. Any workaround needs separate approval.

**G0. Preflight: launch and tracer feasibility,** run before any baseline run.

*Launch:*
- The direct-exec launch reaches native readiness, serves CDP and writes its profile only into the agent data dir.
- Its helpers start with sandbox arguments identical to a LaunchServices run of the same build.
- Debugger authorization behavior is recorded as observed: no prompt, one prompt per session, or one per launch.

*Image and breakpoints:*
- The loaded ArcCore's executable sections are byte-equal to the pristine 1.170.0 slice's, with only the signature differing.
- All 1,566 ArcCore and 270 app breakpoints resolve before the image's initializers run. An unresolved or late breakpoint fails the preflight.
- At every planted address, the original bytes the tracer read equal the pristine file's.
- The app's patch manifest is checked against the instrumented IMP functions' ranges: no overlap is allowed.

*Positive attribution controls,* each confirmed with the expected (owner, selector):
- an instance method on a unique IMP: `-[ArcBrowserApplication init:]` `0x43e6548`;
- a class method;
- a shared-IMP method;
- a base/category pair with the same selector: base `setUserActivityDelegate:` `0x43fe218` vs the Extensions category `0x441066c`, if both are reached;
- an app callback.

*Inherited-receiver control:* a receiver whose class is a subclass of the declaring owner (Swift or KVO).
- If the scenario reaches one, it must attribute to the declaring owner, with the receiver class recorded separately.
- If none is reached, the superclass walk is reported as **not exercised**. Any later hit that depends on it is then recorded as `imp_only` rather than attributed.

*Negative control:* a mismatched `x1` is recorded as `imp_only`.

If any part fails, stop. The fallback is an in-process trampoline tracer, which is new native code in the app, so it needs its own approval and review.

**G1. Provenance.** Every run writes `manifest.json` with:
- the pristine source pins (`4c03750e…682` app, `69276ada…3dd` engine) and the runtime hash of each re-signed file;
- the result of the executable-section comparison from G0;
- the ArcMod commit and patch-manifest hash, and the agent dylib hash;
- every helper's runtime hash and signing;
- the macOS build, harness git revision, exact launch command, arguments, environment, ports and timestamps.

A run with a missing field is invalid.

**G2. The harness can fail.** Each mutation runs once and is deterministic.
- A wrong expected title must make S2 `fail`.
- **Renderer kill.** The fixture server holds fixture B's response open until the harness releases it. While the navigation is still pending, `kill -9` the renderer. S3 must end `fail` or `inconclusive`.
- **Timeout.** The fixture sets its title only after the server releases a delayed response, which the harness never releases in this mutation. The step must end `inconclusive` at its deadline.

**G3. Repeatable reference outcomes.** Five untraced direct-exec runs. This is a bounded repeatability check, not a reliability statistic.
- Every step's outcome is the same in 5/5 runs.
- S1–S8 must all pass. S7 checks storage persistence only; tab restoration isn't asserted.
- A stable failure is reported as a baseline finding, with logs. The gate stays failed unless Rahul accepts that finding in writing.
- Any mixed outcome fails the gate. A step is excluded only if Rahul approves a written reason.

**G4. Tracing preserves outcomes.** Three traced runs give the same asserted step outcomes as G3. Scheduling isn't expected to be unchanged.
- Total traced wall time must be no more than 3× untraced.
- A capped shared IMP or a missed deadline is reported, never hidden.
- The trace is labelled browser-process only.

**G5. Engine entries are accounted for.**
- Every confirmed entry joins exactly one row of `specs/methods.tsv` by class, category, kind and selector.
- Any `x1` mismatch on a unique IMP is listed with its address and explained. An unexplained mismatch fails the gate.
- Shared IMPs report three counts: attributed, `imp_only` and `capped`. They are never folded into a single coverage number.
- At least 90% of the shared IMPs entered must have one or more attributed (owner, selector) pairs. Below that, the tracer counts as not useful, and the gate fails.
- Every `imp_only` and `capped` IMP is listed with its reason.
- The core set (entered in 3/3 traced runs) is listed separately from the variable set.

**G6. App callbacks are accounted for.** Same as G5, joined against `app-contract-joins.tsv` and the protocol method census ([callbacks.tsv](../../arc-engine/research/2026-10-22-sol/evidence/agents/protocols/initial/callbacks.tsv)). Protocol role distinctions are kept, for example value protocols versus callbacks. The six guide identities without binary-send confirmation are each reported as observed or not observed in this scenario. "Not observed" doesn't establish that a callback is unused.

**G7. Process lifetime.** Every observed process appears in the record with its role and signing, and all of them exit by the S6 and S8 deadlines. Polling gaps and collection failures are listed. Aperitif mapping is recorded per helper role and labelled sample-time only.

**G8. Isolation.**
- Writes happen only under the allowed paths: `~/Library/Application Support/ArcModAgent-<slug>` and the agent build's own caches; the preference domain `company.thebrowser.Browser.mod.agent.<slug>`; the session lease `~/.arcmod/leases/<slug>.lock`; the results dir; launcher logs.
- The protected-path audit shows no ctime or content change.
- NetLog has no request to the hosts ArcMod filters (vendor services). Every other Chromium non-loopback destination is listed.
- App-layer traffic is covered only by the blocked-host log, and the report says so.
- Chromium's sandbox stays enabled in all runs.

**G9. Evidence discipline.**
- Each output row copies its source fields verbatim and adds a provenance column naming the source file and row key. Fields a source lacks stay blank and are never synthesized. Confidence labels are writer-specific and are not ranked or aggregated.
  - `launch-surface.tsv` copies `source_writer`, `confidence`, `semantic_status` and `unresolved_question` from `specs/methods.tsv`.
  - `callbacks.tsv` copies `classification`, `confidence` and `unresolved_question` from the protocol census `callbacks.tsv`, which has no writer or `semantic_status` column.
- Observation columns are added only: step, runs entered (k/3), first thread, first-entry rank, attribution status.
- No row is marked implemented, contract-complete, required or unused.
- Rows that weren't entered are labelled "not observed in this scenario".
- `specs/` and `research/` stay untouched; Codex owns them, and the research is immutable.

**G10. Fresh review.** An independent gpt-6.1-sol/high reviewer:
- reruns the analysis scripts on the retained raw outputs, without relaunching the app;
- confirms the counts, joins and gate results;
- checks the report for overclaims.

Material findings get resolved before milestone 1 is called done.

## Outputs

- `arc-engine/tests/launch-slice/`: harness, frozen fixtures, the lldb tracer (Python) and the analysis scripts. Plain Bun/TypeScript like `tests/engine-swap/`.
- `arc-engine/results/launch-slice/<run-id>/`: manifests, step results, raw traces, process records, NetLogs, write audits, logs, `launch-surface.tsv`, `callbacks.tsv` and `report.md` with limits.
- `NEXT.md` and `ENGINE.md` updated. No changes to `specs/` or `research/2026-10-22-sol/`.

## What milestone 1 settles, and what stays open

**Settles, for this scenario, this engine and the ArcMod app layer only:**
- Asserted reference outcomes for launch, navigation, storage, teardown and restart, plus a harness that can fail.
- A lower bound of the engine and app-callback identities entered in the browser process, with first thread, step and debugger-ordered rank, and counts of unattributed and capped hits.
- The Chromium network-stack destinations of this scenario. App-layer traffic is covered only by blocked-host logs.
- The helper processes seen, with their roles, signing, sample-time Aperitif mapping and exit behavior.

**Stays open:**
- Which native services or helpers a replacement can omit or defer. Observed entries don't answer this.
- The contract of any method beyond "entered here first, on this thread". Arguments, ownership, cardinality, late or repeated responses, enum names and error paths stay at the spec's stated confidence.
- Every other scenario: extensions, downloads, DevTools, media, dialogs, multiwindow.
- The pristine-signed-app gap, real-profile migration, distribution signing, passkeys and effort estimates.
- The 97 unresolved and 1,670 open-question rows. An entry adds one scoped observation; it doesn't close a row.

**Decision this enables:** whether to authorize stage 5, a launch-only vertical slice on our Chromium 156 build. Its scoping would start from the observed core set plus the native dependencies the report already identifies, and its pass bar would be this harness. Narrow static requests from the report's stage 2 can then target callback adapters that were actually entered. For example: profile completion `0x43eb7a0`, if `createBrowserContext:isHidden:type:completion:error:` is entered on first launch.

## Prerequisites and constraints

- **Debugger authorization.** This Mac reports "Developer mode is currently disabled" (`DevToolsSecurity -status`). macOS may then ask for admin authorization when lldb starts a process. G0 records what actually happens. If prompts block unattended runs, Rahul chooses: run `sudo DevToolsSecurity -enable`, or approve the prompts during traced runs. The untraced runs don't need a debugger.
- Runs use ArcMod agent builds on this Mac, with disposable data dirs and localhost fixtures, following the repo's agent-session rules.
- No paid capacity. `arcmod-engine` stays paused: no SSH, resume or resize.
- Research and review subagents use gpt-6.1-sol at high reasoning.
