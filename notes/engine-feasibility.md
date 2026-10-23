# Maintaining an Arc-compatible engine on Chromium 156

The evidence supports investigating an **in-tree Chromium `arc/` bridge first**. Arc's observed interface reaches Chrome profile management, omnibox providers, Web Store installation, persistent extension toolbar state, password-save controllers and native content compositing. A replacement must preserve those app-facing contracts as well as basic page rendering. CEF remains a research option, but its public API and macOS hosting choices have substantial unclosed gates. Neither route has demonstrated replacement readiness.

This is a comprehensive static research synthesis for **Arc app 1.168.0 arm64**, **ArcCore 1.170.0 arm64**, and Chromium **156.0.8078.48**. It incorporates the complete 199-shard export, all selected revised class specifications and their fresh reviews, the 26-protocol audit, the independent body/protocol/acceptance reviews, and small independent binary/source checks. It does not implement a product, execute either native application, or establish a full patch set or maintenance estimate.

The measured result is a stable compared ObjC metadata surface with considerable unresolved behavior. All **146 classes / 1,964 declared method rows** reconcile with the selected revised specs and current binary metadata. **1,670 rows retain open questions; 97 are explicitly unresolved** under their writers' local labels. No method is certified here as a complete runtime implementation contract. The per-class documents are research specifications with those limitations attached.

## Reading the evidence

“Observed” below means retained bytes, parsed metadata, exact indexed pseudocode, or saved test artifacts. Pseudocode is an observation of a decompiler's output, not automatically of correct native behavior. “Source-backed inference” means multiple local anchors and operation sequences agree with pinned primary source; it does not mean byte equality or unchanged implementation. “Unknown” marks behavior that these artifacts cannot establish.

The selected class revision is [CLASS-REVISIONS-READY](../../arc-engine/research/2026-10-22-sol/evidence/CLASS-REVISIONS-READY), SHA-256 `58b7e65868a774783345bc65391f16d6d983e61f648a2e604a5ec9d2d69afc8e`. The [spec index](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/spec-index.tsv) links all 146 selected v1 class docs, correction ledgers, fresh reviews, historical reviewer provenance and content hashes. The [coverage appendix](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/coverage-appendix.md) lists each class's retained limits and all 26 protocol specs. Historical `specs/` and `classreview/` documents remain useful evidence of corrections, but their superseded prose is not the basis for this report.

Independent verification and limitations are recorded in [report.md](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/report.md), [audit.json](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/evidence/audit.json), [spot-checks.json](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/evidence/spot-checks.json) and [findings.tsv](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/findings.tsv). The analysis inspected other roles' actual tables and validation code; it did not merely combine their conclusions or rerun their output-writing tools.

### Image, revision and address provenance

| Input | SHA-256 | Use and limit |
|---|---|---|
| Arc-1.168.0.arm64 | `4c03750e2a2c4f8843dec4b90db2e0f1c5e4ba01ef2140e3961a6194bcc9d682` | Pristine app call instructions and app metadata; older app pseudocode is separate evidence |
| ArcCore-1.170.0.arm64 | `69276adaca785a46f2554e7fd18926e7fcdd6aba44ba64400a337427817db3dd` | Current engine bytes, metadata and indexed export |
| ArcCore-1.168.0.arm64 | `ca439a53a40f633cde10182533408b2220d8c918c04d22a12a6ba25ae2563c53` | Retained metadata and bounded raw method-entry comparisons; no comprehensive older-body comparison |
| ChromiumFramework-156.arm64 | `39647a537f42460da18576c0a5856171dfec2250ed505698dbbdd99a40b75645` | Unstripped same-version stock baseline with different optimization/link settings |
| libaperitif.dylib | `780aa93afe922c9756df21c32bbf98b844126a088d1953680b06f19d430dc955` | Small universal binary triage, not part of the engine C export |

Hashes and sizes are reproduced in [image-pins.tsv](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/evidence/image-pins.tsv). Chromium source is pinned to [`d0c02bfad08ec92a6ffcf989e53cd995e6381a4c`](https://chromium.googlesource.com/chromium/src/+/d0c02bfad08ec92a6ffcf989e53cd995e6381a4c/); CEF to [`426920c33ef22551e0b8f48cf343d623ac25642d`](https://github.com/chromiumembedded/cef/tree/426920c33ef22551e0b8f48cf343d623ac25642d). CEF's `CHROMIUM_BUILD_COMPATIBILITY.txt:10` selects `.48`. The previously archived published arm64 `.17` snapshot is a different distribution; no corresponding working `.48` CEF binary was demonstrated. The exact source anchors, hashes, line ranges and public URLs are in [source-pins.tsv](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/evidence/source-pins.tsv); [official-source-checks.tsv](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/evidence/official-source-checks.tsv) verifies 184 CEF, 17 successful Chromium and 179 published-snapshot source files. The Chromium manifest also preserves one explicit failed fetch, which is not an absent API finding.

Unless stated otherwise, engine VAs in this report are **unslid ArcCore 1.170.0** VAs, and `0x100…` call addresses belong to **Arc app 1.168.0**. File offsets are translated through Mach-O segments, never equated with VAs by assumption. Original-shard byte offsets, object-field offsets and image addresses have separate meanings. The review independently handles chained pointer formats 2 and 6 where encountered. No address is a live-process address.

## Measured surface: declarations, imports, exports and calls

| Set | Measurement | What it establishes |
|---|---:|---|
| Stable engine export names, 1.168/1.169/1.170 retained inventories | 259 | 146 class symbols, 105 metaclass symbols and eight other exports; name stability, not ABI equality |
| App imports from ArcCore | 67 | 63 class imports and four others: `_ArcErrorDomain`, `_CallWithEHFrame`, `_emitTraceEvent`, `_arcCategoryEnabledFlag` |
| Declarations on the 63 imported classes | 834 | 786 base + 48 category rows; 830 class/kind/selector dispatch keys; **not 834 used methods** |
| All parsed Arc-prefixed metadata | 146 classes / 1,964 rows | 1,821 base + 143 category; 1,948 instance + 16 class methods; full class/category/kind/selector identity |
| Global distinct IMPs for those rows | 1,566 | Aliases and shared implementations prevent equating declarations with functions |
| Successful exact indexed method IMPs | 1,565 | Sole missing exact method header `0x4410bb4` is a verified branch to `0x47390dc` |
| Retained app dispatch/import call table | 4,353 rows | 4,336 selector rows with binary+pseudocode support, six C-import rows with both, 11 pseudocode-only rows |
| Independent app branch verification | 5,353 distinct B/BL instructions | Mapped bytes and branch targets agree with retained evidence; not 5,353 receiver-confirmed Arc calls |

The additional 83 metadata classes beyond the imported-class set are not proven unreachable. Returned objects, service getters, factories, categories and delegates expose objects without a corresponding class-symbol import. Conversely, a selector send through a verified stub does not generally determine its receiver class. The app instruction table supports concrete call-site claims, not a count of uniquely app-used engine methods. No complete dynamic reachable set has been measured.

Base and category methods remain separate even if their selector is identical. For example, `ArcPermissionRequest` base `additionalData @ 0x2d0fb40` is a shared `self+8` object getter; the Extensions implementation at `0x440a85c` constructs a dictionary. A sampled app `additionalData` send also has autocomplete-related surrounding calls and is not proof of a permission-request receiver. Ghidra's chosen symbol can name an unrelated shared implementation. Explicit metadata membership controls attribution.

### What actually matches between old and current engines

Across the parsed Arc-prefixed surface, **all 1,964 method declaration identities/raw encodings and all retained instance-layout metadata for 146 classes match between 1.168.0 and 1.170.0**. The instance records cover 351 ivars. Compared fields include flags, superclass, instance start/size, names/types/numeric offsets/sizes/alignment and retained strong/weak maps, excluding image/address anchors. The independent audit reproduced the retained comparison rather than matching dyld/otool rows by position. See [metadata-keys.tsv](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/evidence/metadata-keys.tsv), [parent comparison](../../arc-engine/research/2026-10-22-sol/evidence/inputs/context/parent-metadata-comparison.json), and the [protocol evidence review](../../arc-engine/research/2026-10-22-sol/evidence/inputs/context/protocol-evidence-review.md).

The parent additionally reread six method-list entries in each copied engine: **12 raw checks** corroborate list membership/alignment and selector/type/IMP bytes. All six old/current encodings agree, including **signed `q` for `ArcSessionID.identifier`**. Class/category attribution rests on full metadata traversal, not those 12 local checks alone. [older-entry-checks.tsv](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/evidence/older-entry-checks.tsv) independently reproduces the bytes. This closes the old encoding-association gap.

**Compared-field limits:** properties, all protocol conformance, metaclass layouts, native C++ ABI, implementation bodies, runtime layouts and behavior were not comprehensively compared. Equal ObjC encoding strings do not determine aggregate return conventions, native pointer ownership, enum meanings or callback scheduling. Historical `ENGINE.md`'s `_mouseInside` addition attributed to ArcWebContents is not reproduced in either retained Arc-prefixed layout set; no alternate containing class is established here.

## Observed bootstrap, service and view architecture

The short paths below combine observed call structure with explicitly qualified source identities. They identify compatibility work that precedes ordinary page-feature parity.

### Application and process lifecycle

The app's initializer call at `0x1004aa8c8` reaches `ArcBrowserApplication::init: @ 0x43e6548`. The observed engine route creates/obtains native application state and LocalState and installs a weak delegate bridge. `initialize @ 0x43e6fc8` constructs configuration via `0x43ec404`, then reaches `0x42b0850 → 0x42aa7ec → 0x2d2f3cc`. Locale/signal handling, initialization/reinitialization and run sequencing strongly identify the last region as `content::RunContentProcess`; pinned `content/app/content_main.cc:189` supplies the source anchor. This is source-backed role agreement, not proof of identical compiled code.

App run evidence at `0x1004ae240` reaches `run @ 0x43e6ec0 → 0x42b1ba8 → 0x42aac34`. The latter names `arc/browser/arc_browser_runner.cc`, `RunMainLoop`, and calls source-backed KeepAliveRegistry register/unregister routines. Shutdown reaches a source-backed BrowserMainRunnerImpl region at `0x318b9bc`. Historical suggestions that the app's main directly calls `_ChromeMain` are not established by this path. Stable launch exports do not replace observed ObjC bootstrap evidence.

Configuration pseudocode includes a malformed initializer prototype. Revised spec-4 evidence recovers stack byte/pointer loads and object stores, but not a validated callable C++ prototype or all consumer behavior. Startup adapter `0x42c18f0` lacks an exact exported header. Initialization notification order, repeated initialization, error unwind and process-role handling remain launch gates. The detailed retained paths are in [Arc-layer report](../../arc-engine/research/2026-10-22-sol/evidence/agents/arc-layer/decompile/report.md) and [CEF body report](../../arc-engine/research/2026-10-22-sol/evidence/agents/cef/decompile/report.md).

### Profiles and service ownership

`createBrowserContext… @ 0x43e8368 → 0x42b3d74 → 0x7bdc470` strongly matches `ProfileManager::CreateMultiProfileAsync`, pinned `chrome/browser/profiles/profile_manager.cc:1037–1098`: generate an unused profile path, create attributes, pair hidden/ephemeral/omitted flags, bind initialized callbacks and schedule work. App BL `0x1004af488` supplies a copied completion block and checks BOOL/NSError. Generic isolated network-context creation covers only part of this observed behavior. The ObjC callback adapter `0x43eb7a0` is still an exact-header gap.

Native context service state is constructed before lazily cached ObjC service wrappers. It is therefore unsafe to infer that a service can be omitted or deferred just because its wrapper getter has not been called. Context and browser WebContents factory paths differ even where both reach source-backed CreateWithOpener behavior. Profile readiness, service initialization order, persisted schema, session restore and migration are unresolved beyond the local observations. Shared native handles and weak controls are recurring bridge patterns; raw pointers and mutable accessors also appear. They are not replaceable with object names alone.

### Native views and compositor integration

The app directly invokes `nativeView`, `createPaneHostView`, `attachToPaneHostView:` and `detachFromPaneHostView:` at `0x100542690`, `0x1005426b4`, `0x1005426d4` and `0x1005426e8`, loading the saved WebContentChromium webView field. The pane creation IMP `0x4410bb4` has no exact C header, but mapped instruction `0x140ca14a` branches to `0x47390dc`, which allocates `WebContentsPaneHostView` and initializes it with NSZeroRect.

Attach/detach bridges `0x4739114/0x47391c8` perform an exact `isMemberOfClass:` check before their pane operations. Native content hosting is distinct from pane hosting. Host classes also implement layout, focus, display and bridge lifetime operations. At `0x473cad8`, exact WebContentsHostView/known-subview/ViewsHostable checks conditionally reach `0x6846c88`; CATransaction, layer transfer and compositor operations strongly match `RenderWidgetHostViewMac::TakeFallbackContentFrom`, pinned `content/browser/renderer_host/render_widget_host_view_mac.mm:1229–1247`.

This is a substantive embedding contract. A generic NSView containing web content has not demonstrated compatibility. Focus, input method, drag/drop, accessibility, resize coalescing, fallback content, GPU loss, view detachment and destruction need native tests. The complete shards resolve the earlier missing pane target; they do not resolve these runtime behaviors.

## ABI, delegates, callbacks and errors

The ABI report's [contracts.tsv](../../arc-engine/research/2026-10-22-sol/evidence/agents/abi/decompile/contracts.tsv), bounded instruction evidence and exact bodies support local rules. The independent body/protocol reviews correct their overly broad interpretations.

| Boundary | Supported observation | Remaining contract |
|---|---|---|
| Optional/shared return | `ArcWebContents::web_contents @ 0x4443ee0` initializes empty return storage; engagement at self+0x128 controls peer/control copying and nonnull control refcount increment | Aggregate caller ABI, native invalidation and null return-storage safety; the X8 trap is inside the engaged path |
| Nil delegate assignment | Downloads `0x4041fec`, context `0x43ed9a8` and history paths skip weak-target updates on nil and take temporary cleanup | Nil does not establish unregister/cancellation; weak expiration and queued work require separate analysis |
| Navigation delegate removal | `0x4440dec → 0x4375b40` clears native +0x3a8/+0x3b0 pair and releases prior weak control | Does not prove wrapper bridge destruction or suppression of queued callbacks |
| Other removal paths | Menu clears native slots; side-panel/BoostIDE/tracing have explicit wrapper-clear observations | These differences rule out one generic unregister implementation; subsystem teardown remains open |
| Navigation policy | `0x4445a58` sends `webContents:decidePolicyForNavigationAction:` then immediately range checks returned x0; unsigned 0–11 accepted, otherwise trap | Synchronous bridge rule established; ordinal names and total app mapping are not |
| Permission response | `0x4446dcc` preserves unsigned 0–2 and maps other representations to 3; quiet reason preserves 1–5, otherwise 0 | Enum names, default policy, prompt sequence and late-response handling |
| Filename selection | Missing-header bridge `0x4042728` sends filename/default/timeout/completion; `0x40428ac` adapts one object argument; app fallback invokes default when its own weak delegate is absent | Timeout units, engine-side weak-target fallback, deadline, late response and exactly-once behavior |
| DevTools open | Metadata `@32@0:8@?16^@24`; binary saves error-out from x3, rejecting spurious extra Ghidra argument; callback `0x4416690` supplies `(message,nil)` or `(nil,NSError)` | Complete handle reuse, teardown, task-runner identity and queued-delivery suppression |
| DevTools task ownership | `0x435c8fc/0x435ca2c` copy callable state into an owned task and invoke it; send/receive paths have 8 MiB guards | This supports owned queued storage; it does not establish main-thread execution or global delivery guarantees |
| NSError conversion | Exported domain points to `company.thebrowser.Arc`; `0x44025f4` maps native codes and localized descriptions | Complete code catalog, all error paths and app expectations |

### Termination retention correction

The ObjC wrapper `tryToTerminate: @ 0x43e6ee0` retains temporary block storage. Native `0x42b2430` copies/stores callable state at application offsets **+0x150..+0x168 only on the first initialized termination request**, when the observed request flag is zero. Repeated requests return **2** without storing the new callback. The first path may continue synchronously into `0x42b258c`. Neither storage nor the immediate status proves survival beyond return on every path, eventual completion, exactly-once delivery or enum names.

This replaces the broader “owned beyond the caller's temporary copy” statement in historical ABI/protocol report prose. The [exact sampled body](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/evidence/body-42b2430.c) and [independent protocol correction](../../arc-engine/research/2026-10-22-sol/evidence/inputs/context/protocol-evidence-review.md) control the synthesis. Temporary ObjC wrapper storage and conditional native callable storage must remain distinct.

### `_CallWithEHFrame` is recovered beyond its missing header

Export `0x441d770` branches to `0x2e0238`. The ordinary instructions synchronously load the block's invoke pointer at +16, invoke it and return without retaining/copying it. App callers copy/release around the import, supporting a borrowed synchronous block contract. However, the tiny C-header byte count omits a landing pad: the FDE at `0xd81603c` covers **32 bytes**, including `0x2e0250`; CIE `0xd816020` and pointer slot `0xd824008` lead to personality `0x83af738`. Its search-phase branch agrees with Chromium's special search-terminating exception frame.

Pinned sources `base/apple/call_with_eh_frame_asm.S:23,51–84` and `call_with_eh_frame.cc:19–43` explain the mechanism. This is still an exported-header gap, but no longer a wholly unknown contract. A plain forwarding call would discard evidenced unwind behavior. The non-search target was not independently symbolically named and no runtime throw test was run. The ABI role's [ehframe-unwind.json](../../arc-engine/research/2026-10-22-sol/evidence/agents/abi/decompile/ehframe-unwind.json) and this review's instruction checks retain byte provenance.

### Protocol purpose and callback coverage

The [protocol index](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/protocol-index.tsv) links **26 protocol specs**, with **235 physical method entries**, **200 unique protocol/kind/selector identities** and **198 selector names**. Two DevTools command/event protocols contain **five value getter identities**; they are not engine callbacks. The remaining 24 contain **195 candidate callback or app-service identities**, including a synchronous navigation policy and app-provided services. Of those, **189** have static selector-send support. The combined table has **195 send VAs / 192 selectors**, supporting **194 identities** including the five value getters. Counts describe evidence categories, not runtime invocation counts.

App evidence includes **270 implementation joins across 18 explicit adopter classes**. Thirteen raw annotation differences erase to equal annotation-free encodings. The parsed app descriptor set contains 385 protocols including the 26 Arc names; each parsed engine set contains 69 descriptors and zero Arc names. That bounded absence is compatible with selector-based calls and cannot establish unused protocols.

Extended types are paired using required-instance/class then optional-instance/class list prefix counts and each physical entry's index. The cached primary source is objc4 [`fb265098298302243cd7eeaa1f63f0ba7786dd9a`](https://github.com/apple-oss-distributions/objc4/blob/fb265098298302243cd7eeaa1f63f0ba7786dd9a/runtime/objc-runtime-new.mm#L4885), `objc-runtime-new.mm:4885–4924`; this supports the pairing rule without identifying Arc's shipped ObjC runtime revision. Pairing is by explicit identity/membership, not blind row order.

Dialog types establish zero-argument alert completion `void (^)(void)`, BOOL confirm/before-unload, NSString text completion and uint64 permission response. Types alone do not establish thread, lifetime, cancellation, cardinality or reentrancy. Six guide identities lack bounded binary-send confirmation: Dia resource handling, pinned-order notification, extension readiness, notification display/close and provisional redirect. Their absence is an unresolved invocation question. Use the [combined static sends](../../arc-engine/research/2026-10-22-sol/evidence/agents/protocols/initial/evidence/engine-all-static-sends.tsv), including `webContents:updateDevToolsToolbox: @ 0x4447edc`, rather than the older narrow send table.

## Arc/Chromium boundaries and CEF comparison

### Positive service-path evidence

The following are source-backed identities in sampled regions, not a claim that all of ArcCore is stock or that these are the only edits.

| App-facing operation | Observed engine path | Exact Chromium source anchor / consequence |
|---|---|---|
| Named profile creation | `0x43e8368 → 0x42b3d74 → 0x7bdc470` | `chrome/browser/profiles/profile_manager.cc:1037–1098`; profile attributes and initialized callbacks exceed a simple request-context mapping |
| Context autocomplete | `0x43f5f60 → 0x42c2f5c`; query via `0x42c35e4 → 0x20cd850` | `components/omnibox/browser/autocomplete_controller.cc:631–760`; provider iteration, observer and timing anchors |
| Browser autocomplete queried by app | `0x43e1f80 → 0x42fbd80 → 0x20cd850`, app BL `0x1005278bc` | Arc-specific lifetime/blank input/keyword/error/controller recreation around the upstream query; result/ranking equivalence unmeasured |
| Web Store install | `0x43fd304 → 0x42e6790 → 0x786cd50 → 0x784a050` | `webstore_install_with_prompt.cc:17–33`, `webstore_standalone_installer.cc:54–87`; app passes unattended=1 and a copied completion |
| Extension pinned order | `0x43fdd3c → 0x42eb57c → 0x7cd94c0/0x7cd9ea0/0x7cd9f40` | `toolbar_actions_model.cc:476–590,688–712`; persisted preference and forced-pin neighbor handling, not just visual array order |
| Form-password save | `0x443f038 → 0x7d64988 → 0x78b2e84` | `save_update_bubble_controller.cc:140–150`, `manage_passwords_ui_controller.cc:961–1012`; declared engine dependency; direct app use not demonstrated |
| Content fallback transfer | `0x473cad8 → 0x6846c88` conditionally | `render_widget_host_view_mac.mm:1229–1247`; compositor/layer integration |

For unattended Web Store installation, observed vtable changes replace a prompt allocator with a return-zero body and clear the post-install UI byte. Pinned `webstore_standalone_installer.h:117` and `.cc:136–148` document accepting a null prompt hook. This supports prompt suppression locally. Another changed vtable slot lacks an exact body; complete custom install policy/UI/error behavior is unresolved. No live extension install was performed in this research.

Other source-backed samples include preference writes, keepalive register/unregister, bookmark-model load scheduling, GPU UI callback dispatch and tab membership search. A Chromium-owned function can contain inlined `arc/` diagnostics or UI helpers. Therefore an `arc/` path inside one function does not establish exclusive proprietary ownership. Conversely, finding an upstream class or source path does not prove Arc made no semantic changes.

Two bounded modification candidates deserve follow-up. Full-page capture `0x4442be0 → 0x4376fb0 → 0x435da28` has a texture-size preflight identifying `GetMaxTextureSize` and `content/public/browser/gpu_utils.cc`, followed by `Page.captureScreenshot` with `fromSurface` and `captureBeyondViewport`. That helper is absent from four complete exact-revision GPU files examined in the matcher report. This is positive call-context evidence plus focused source comparison, not merely a missing path; the exact patch/signature/service slot still is not recovered. Separately, source-backed `BrowserUiController::ScheduleUIUpdate @ 0x16b9d84` appears to use a tab-membership search guard where upstream uses TabInterface/window matching. Coherent instructions and detach-state behavior must decide whether this is a semantic difference.

### CEF route gates

The CEF inventory classifies the **834 declarations**, provisionally: **11 direct public operations, 136 partial CEF-plus-bridge, three observed Chrome-internal dependencies, 319 Arc interface/behavior rows and 365 unresolved**. The categories reconcile numerically but are not an implementation-completion score or percentages of app-used functionality. Additional source-backed body findings can motivate reclassification; no automatic whole-class API-equivalence claim follows.

CEF source distinguishes runtime bootstrap from browser/window style. Alloy bootstrap was removed in M128; Alloy **style** remains under Chrome bootstrap, alongside Chrome style. Pinned `docs/architecture.md:140` and `include/internal/cef_types_runtime.h:39` describe the distinction. Critically, `include/internal/cef_types_mac.h:151–152` says **`parent_view` always uses Alloy style**. Chrome-style feature availability and arbitrary parent NSView embedding cannot simply be combined by choosing a label. This is a documented constraint, not proof that CEF is impossible.

| Contract | In-tree Chromium route | CEF route / experiment required |
|---|---|---|
| Frozen ObjC interface | Implement compatibility bridge over the matching native services; preserve layouts/aggregate ABI where actually required | Same bridge work remains; a CEF C/C++ public API does not reproduce ObjC object identity, layout or ownership |
| Bootstrap/process lifecycle | Integrate Arc-specific runner/hooks with content and Chrome lifecycle | Demonstrate app-owned launch/run/shutdown with CEF lifecycle and exact subprocess behavior |
| Profiles | Access matching ProfileManager/keyed services; still recover Arc readiness/errors/migrations | Prove `CefRequestContext` covers profile attributes, initialization notification, persistence and service access, or maintain libcef changes |
| Native embedding | Adapt content/Views/Cocoa host contract at its natural seam | Prototype the exact pane/native host operations under parent-view Alloy; separately demonstrate needed Chrome services |
| Omnibox | Existing Chrome provider/controller path is available to integrate | Public equivalent, composed substitute or libcef exposure must reproduce query/result/error/cancellation behavior |
| Extensions | Existing installer/toolbar services are source-visible | Demonstrate programmatic Web Store unattended install and persisted pin policy; privileged unpacked CDP load is insufficient |
| Password/autofill services | Matching Chrome controllers exist; app bridge remains work | HTTP-auth `CefAuthCallback` is not the observed form-password save contract; prove service exposure or modification path |
| Arc renderer IPC/effects/adblock | Add/recover real interfaces and registrations | Equivalent browser-renderer hooks and schema/version behavior must be demonstrated |
| Upstream updates | Carry an explicit source patch set and ABI/behavior regression suite | Reduce internals only if public APIs actually cover contracts; otherwise carry CEF plus Chromium modifications |

Source availability makes the in-tree seams easier to investigate given present evidence. It does not bound patch volume, guarantee future API stability or prove a maintained fork is affordable. CEF should advance only after the hosting/profile/service gates above pass at the exact source/binary revision; failure should be localized to a contract, not generalized from an absent header string.

## Coverage of requested subsystem areas

“Covered” here means inventory and bounded research evidence, with the limits in each row. It does not mean a complete implementation spec. All selected class docs are linked in the appendix, including conversion/value wrappers outside the imported set.

| Area | Evidence available | Unresolved validation / implementation requirement |
|---|---|---|
| Bootstrap, process roles, shutdown | Runner/content lifecycle, weak app delegate, conditional termination storage, EH frame | Callback order, errors/reinit, helpers, entitlements, sandbox, runtime throws and termination outcomes |
| Profiles, session, storage, import | ProfileManager path, context services, session/value/import specs, equal retained layouts | Existing profile migration, readiness, persisted schemas, ID sentinels, restore fidelity and import cancellation |
| History, omnibox, bookmarks, search | Service wrappers, preference calls, real autocomplete controller, model-load callback source identity | Provider/ranking/result behavior, keyword mappings, persistence, async ordering and policy |
| Passwords, autofill, passkeys, security | Request/value/conversion classes; sampled form-password controller path | Full fill/save/account-store behavior, passkey/WebAuthn native UI and storage, secure context/error equivalence |
| Extensions | Installer, unattended prompt-suppression evidence, toolbar prefs, errors/delegates | Normal install/update/signing, policy/incognito, service worker lifecycle, persistence and UI callbacks |
| Browser/windows, native views, PiP | Factory paths, pane/host classes, layout/focus/compositor samples, PiP/side-panel specs | Native runtime integration, input/IME, drag, multiwindow, fullscreen/PiP ownership and teardown |
| Dialogs, permissions, menus, notifications | Typed completions, policy ranges, specific nil paths, direct tagged-result notification bridge | Presentation sequence, enum names, defaults, cancellation/reentrancy/cardinality; six unconfirmed guide identities |
| Downloads and network | Actual filename bridge/adapters, weak registration, pause/cancel/resume wrappers, network lifecycle notifications | Timeout units, late completion, exact native vtable, retries/interception, download contents and persistence |
| DevTools, BoostIDE, WebUI | Error-out ABI, map/handle/tasks, protocol value objects, native string payload/tag evidence | Executor, close races, JS receiving behavior, handle reuse and typed payload schemas |
| Renderer IPC, effects, adblock | RenderProcessAgent/RenderFrameAgent remote/receiver plumbing; EffectsAgent/AdBlockerAgent registration | Exact schemas/ordinals, dispatch/validation bodies, version negotiation, feature necessity and lifetimes |
| Extraction, AI, ranking, conversion | All relevant revised class matrices; native vectors/strings/optionals and model config fields | Inference backend/model lifecycle, extraction semantics, conversion deep ownership; ranking candidates/training delta remain suspect/unresolved |
| PDF, image, capture | PDF/image/media wrappers; full-page capture chain; saved simple PDF screenshots | Real file operations, print/multipage/selection, GPU capture limits and callback adapters, fidelity and failure paths |
| Media, DRM, WebRTC | Media value/protocol surface and saved capability probes | Widevine licensed playback, audio/capture/device permissions, real decode/encode matrix; both saved data-channel probes time out |
| Accessibility | Action/tree wrappers, observer; matcher false-positive control checked against source | Full native accessibility tree/actions, lifecycle, assistive technology compatibility |
| Performance, tracing, crash, memory | Metrics/histogram/tracing classes, imports and callback types; ownership/destructor corrections | Trace semantics, full crash setup, native allocation/memory pressure and leak/retention behavior |

IPC examples have real plumbing, beyond strings: `0x43755a4` packages a RenderProcessAgent remote; `0x43aa39c/0x43aaea8` construct receiver state. `0x43a809c` registers EffectsAgent/AdBlockerAgent names and captured binders. Generated-looking dispatch labels and binder targets lack exact headers. Presence does not recover an interface schema or prove startup necessity.

Revised class reviews repaired important semantic overclaims: optional returns, omitted `#%08X` text-color vararg, destruction as clearing rather than replacement, container assignment rather than registration, weak-retained return, notification tagged-result routing, native string payload versus claimed JSON parsing, and configuration stack-argument artifacts. All **32 historical findings** have fresh dispositions: **eight resolved, 24 resolved_with_limits**. The [correction ledger crosswalk](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/evidence/correction-dispositions.tsv) retains each original finding and remaining unknown. These corrections improve research accuracy without supplying missing transitive behavior.

`ArcCommandBarRankingExample.candidates` and `ArcCommandBarRankingTrainingResult.delta` remain explicitly unresolved around incoherent cleanup/read ordering. Do not publish them as always-empty results or diagnose native use-after-free from this pseudocode. The class review's acceptance means the uncertainty is now stated accurately.

## Corpus, closure and matcher limits

### Complete export does not mean complete semantics

The independent streamed corpus check verifies **199 unique SHA-256-pinned shards**, **1,114,106,346 bytes**, **567,959 headers**, **79 failed placeholders** and **567,880 successful candidates**. Failures classify as 48 timeouts, 24 nonunique varnodes, three out-of-range constructions, three input-varnode adjustments and one forced merge. Successful export can still contain incoherent signatures, omitted arguments, incorrect return types, disconnected regions or unresolved switches. Exact original byte ranges for this review's 19 fresh samples are in [sampled-bodies.tsv](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/evidence/sampled-bodies.tsv).

The saved metadata contains **607,294 rows**. Its third numeric field behaves as enclosing `end-start`, not a contiguous body-byte map. **579,666 starts** lie within a prior enclosing span; summing spans gives **858,548,775**, which is not code coverage. ArcCore lacks LC_FUNCTION_STARTS, so the failed `engine_match.py` prototype cannot supply a successful boundary map. The unstripped stock baseline's function starts do not transfer to a differently optimized engine.

The known malformed `0x421f778` has a 24,347,032-byte enclosing span while its C header reports 10,600 body addresses. Neither licenses treating it as 24 MB of proprietary code. It is excluded from semantic/volume conclusions. Nine other spans above 1 MiB also invalidate naive contiguous-range counting. Two additional warning-bearing merged-recovery candidates, `0x2b7940` and `0x16220b0`, need actual ordered AddressSet ranges and branch/switch evidence before consequential semantic comparison. Distant outlined blocks can be legitimate; an unusual span alone does not invalidate every compact body within it.

The quality audit's earlier open items are reconciled: pane-host veneer recovered; EH branch/unwind contract recovered; six older encodings resolved. Helper analysis, actual function-range repair and complete native behavior remain open. See [quality report](../../arc-engine/research/2026-10-22-sol/evidence/agents/quality/initial/report.md), with current corrections above.

### Keep both handoff definitions

The historical handoff has **5,846 names**, comprising 1,378 ObjC seeds, 524 path/IPC seeds, six exports and 3,938 anonymous callees. Trailing-colon normalization and dictionaries keyed by name conflate distinct identities, including `init` and `init:`; categories and address-taken callbacks are incompletely seeded.

| Definition | Count | Ambiguity |
|---|---:|---|
| All matching metadata candidates for normalized handoff names | **5,859** | **Eight** ambiguous normalized names |
| Subset resolved to exact exported body headers | **5,847** | **One** ambiguous normalized name |
| Arc-layer revised category-aware two-level syntax inventory | **5,793** | A separate seed/parse definition |
| Matcher narrower two-level reconstruction, malformed seed excluded | **5,449** | A separate seed/parse definition |

The 5,847 subset omits 12 metadata candidates and must not overwrite the 5,859/eight result. The [independent body review](../../arc-engine/research/2026-10-22-sol/evidence/inputs/context/body-evidence-review.md) identifies the difference; [closure-definitions.tsv](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/evidence/closure-definitions.tsv) retains the recomputed candidates and availability. Literal `FUN_…(` parsing misses named callees, LAB/address-taken callbacks, virtual calls and dynamic sends and does not stop reliably at a stock boundary. None of these counts is a full reachable set, proprietary-function count or code-volume estimate. The matcher audit also finds 330 declaration rows at 184 IMPs outside the original handoff address set.

### Stock matching provides controls, not an Arc patch census

The matcher accepted **zero reliable unknown-function matches**. Its 512 unnamed anchored pairs remain ambiguous; named controls also show unmatched/ambiguous results. In the closed named retrieval pool, short masked prefixes falsely identify different functions: at 16 bytes, 48 wrong versus 73 correct unique results; at 64 bytes, one wrong versus 30 correct; at 128 bytes, only three positive results. The tiny last sample is not a population precision estimate.

The 64-byte false correspondence is concrete: Arc `0x957ca0c` is accessibility attribute-settable logic, while Arc `0x957d304` is action-description logic; exact source supports their distinct roles. Shared tracing/prologue setup explains misleading entry equality. This review re-extracted both bodies. Different LTO, inlining, ICF, config, symbols, instruction layout and disassembly are sufficient reasons that unmatched code cannot be called proprietary. Source-backed names still do not establish whole-function semantic equivalence.

## Aperitif, helpers and older-engine limits

Aperitif is present in pinned upstream Chromium. `content/public/app/aperitif_mac.h:7` describes initialization before system-library static initializers, chiefly for helper sandboxing. `content/app/aperitif_mac.cc:56` covers early allocator registration and Seatbelt handling; `chrome/app/chrome_exe_main_mac.c:16` checks initialization, and `chrome/browser/mac/aperitif_unittest.mm:41` tests ordering. The copied 169,584-byte universal dylib has sandbox/runtime imports, initializer offsets and `_AperitifCheckInitialized` exports consistent with that role. Its name does not prove proprietary Arc functionality or safe omission.

No full dylib semantic decompile or helper executable/entitlement/load-order analysis was completed. Parent/source harness material and a framework-only export cannot establish renderer/GPU/network helper launch, sandbox equivalence, signing behavior or crash setup. These are launch-critical work, not optional polish. Older 1.168 engine analysis here is restricted to retained metadata and bounded raw method entries. There is no comprehensive older-body behavior baseline against which 1.170 compatibility has been proven.

## What the saved acceptance run establishes

The retained [suite.ts](../../arc-engine/research/2026-10-22-sol/publication/acceptance/tests/engine-swap/suite.ts), extension test, results and screenshots were inspected together with the [independent acceptance review](../../arc-engine/research/2026-10-22-sol/evidence/inputs/context/acceptance-evidence-review.md). This reviewer did not execute them. The saved equality runner has no correctness assertions: equal outputs, including equal errors, can be reported as matching.

| Saved result | Supported interpretation | Missing acceptance evidence |
|---|---|---|
| Both basic screenshots show suite title/red square; both PDF screenshots show a simple one-page fixture | The saved artifacts visibly show those fixtures rendering | Full rendering/layout correctness, complex PDF/print/edit behavior, attributed signed engine provenance |
| WebRTC data channel is `ERR timeout` in both sessions | Equal unresolved failure, not a pass | Successful negotiated data transfer and failure diagnosis |
| Widevine key-system negotiation | Advertised/negotiated capability | Licensed encrypted playback, provisioning and decoder path |
| WebGPU/context/codec capability and tiny 64×64 VP9 playback | Limited availability plus that small decode/play case | GPU output/correctness/load, broad media decode/encode and device permissions |
| IndexedDB write and service-worker registration | Those operations were attempted/reported | Readback, restart persistence, activation/control and offline behavior |
| Download filename existence | A file with expected name was reported | Expected bytes/hash, completion state and restart behavior |
| Extension test reports privileged CDP unpacked load/DOM marker | Narrow harness mechanism; saved primary ext output is absent | Normal install/update/policy, toolbar persistence, extension service worker and real user flow |

The record lacks complete binary/signature/profile provenance, raw per-operation logs and crash records. User-agent versions do not identify binary hashes. Normal Arc profiles, UI flows, migrations and the 1,964-method/200-protocol identity surfaces are not acceptance-covered. Static review and these successful/equal probes therefore do not demonstrate a runtime-ready replacement. A future harness needs explicit expected values, failure/inconclusive states, retained outputs and image attribution.

## Maintenance implications and staged next work

The evidence supports a compatibility layer with at least three kinds of work: a frozen ObjC boundary and native value/lifetime conversions; integration with source-visible Chrome/content services; and recovery/replacement of Arc-specific runner/UI/renderer behavior. Maintaining only an export-name list would miss weak-reference semantics, optional/shared aggregates, unwind metadata and service initialization. Maintaining a fork without a behavior suite would make each Chromium update an unmeasured regression risk.

No whole-rewrite duration, code-size or team-size estimate is defensible from declaration counts or the current call inventories. Any later estimate must assume a defined parity target, access to a reproducible macOS build/signing environment and helper artifacts, an authorized runtime baseline, a chosen source route, and explicit treatment of unknown methods and service dependencies. Each of those assumptions is presently unverified or only partially supported. The most useful current planning unit is an experiment with an exit criterion.

The following is a proposed future validation/implementation sequence, **not work performed or authorized to execute in this research VM**:

1. **Freeze evidence and close publication corrections.** Publish only selected revised specs with their reviews/ledgers; attach the corrected closure definitions, termination qualification, old signed encoding result and compared-field limits. Preserve unresolved behavior as unresolved. Exit: all 146 class paths, 1,964 rows, 26 protocol links and source/image pins validate; no stale summary is presented as current fact.
2. **Repair high-impact boundaries and recover callback contracts.** Request actual function ranges and coherent instructions for profile completion `0x43eb7a0`, startup adapter `0x42c18f0`, filename bridge/adapters `0x4042728/0x40428ac`, termination invoke `0x4044e30`, DevTools invoke `0x4416690`, and native task-runner registration. EH already has a recovered static contract; test its throw behavior rather than declaring it unknown again. Exit: explicit arguments, ownership transitions, error paths and remaining uncertainty per launch-critical callback.
3. **Establish a provenance-rich native baseline.** In a separately authorized macOS environment, record app/engine/helper hashes, signatures, architecture, process roles, clean profile and copied real-profile fixtures. Assert expected outputs and preserve errors/logs/crashes. Exercise startup/run/shutdown, first/repeated termination and sandboxed helpers. Exit: reproducible baseline behavior, including failure cases, rather than equality of two unknown outputs.
4. **Resolve route gates with narrow prototypes.** First compare in-tree bridge seams against actual Arc contracts. If evaluating CEF, demonstrate exact pane attach/detach/layout/focus/compositor behavior with parent-view Alloy, profile readiness/persistence, required omnibox service, unattended Web Store install/pin persistence and form-password save. Exit: each contract has a demonstrated public API/substitution or an explicit source modification; no decision based on missing text alone.
5. **Implement a launch-only vertical slice, after new authorization.** Freeze required binary/ObjC/aggregate/unwind boundaries; integrate runner/profile/native view and minimal navigation with helpers. Do not silently stub dependencies that initialize before their wrappers. Exit: pristine old app starts, creates a profile and native pane, navigates, tears down and restarts with asserted state and clean process lifetime.
6. **Expand by observed app flows and service risk.** Prioritize delegate teardown/queued callbacks, filename timeout/late completion, DevTools close races, multiwindow/profile/session restore, history/search/extension/password services, then media/PDF/accessibility/AI and remaining value conversions. Test nil/expired targets, synchronous callbacks, repeated requests and cancellation. Exit: explicit parity cases and known gaps for each subsystem, with no unresolved spec row marked implemented by availability alone.
7. **Measure update maintenance.** Once an actual patch set and regression suite exist, rebase across a subsequent Chromium revision and measure changed seams, regression/debugging work and required CEF modifications if applicable. Exit: empirical ongoing-maintenance data. Only then attach effort ranges to stated scope and assumptions.

### Specific next evidence requests

The full corpus is present; recopying whole shards will not repair missing exact entry headers or malformed AddressSets. In addition to the callback targets above, recover IPC dispatch/validation entries **`0x4429bcc/0x442ad24`** and Effects/AdBlocker binders **`0x43a8a50/0x43a482c`**. Full-page capture needs stored callback targets **`0x42d62c0`, `0x435e5c4`, `0x4075dc0`** and identification of GPU service slot +0xd8. Inspect actual AddressSets/branches for **`0x421f778`, `0x2b7940`, `0x16220b0`** rather than adding their enclosing spans. Obtain helper/Aperitif semantics, signing/entitlement/load-order evidence, and exact service teardown/task-runner registrations before launch claims.

The current recommendation is therefore to **continue bounded in-tree Chromium compatibility research and defer a product feasibility commitment**. The known surface is now substantially better indexed and locally corroborated. Runtime substitution, complete native ABI/lifetimes, launch packaging and future update cost remain unmeasured.


Research provenance and index: [146 class specifications](../../arc-engine/specs/README.md); [raw global synthesis](../../arc-engine/research/2026-10-22-sol/evidence/agents/review/synthesis/engine-feasibility.md); [frozen completion proof](../../arc-engine/research/2026-10-22-sol/evidence/review-synthesis.completion.json); [readiness selection](../../arc-engine/research/2026-10-22-sol/evidence/CLASS-REVISIONS-READY). This is bounded static research, not runtime acceptance or a claim that every method behavior is fully recovered. Reviewed research publication; remaining behavior and implementation gates are explicit above.


## Parent publication review

The lead verified the genuine terminal `turn.completed`, frozen global input/output hashes and exact revised class/method coverage. Fresh independent spot reviews found no additional material error in the sampled ABI, protocol, closure, source, route and acceptance conclusions. The checks cover retained evidence and declared coverage; they do not certify all transitive semantics or runtime replacement readiness.

The ArcSessionID entry in the preserved spec-4 fresh review still mentions an old-engine encoding ambiguity. Later full metadata traversal and 12 parent raw-entry checks supersede that limit: `identifier` has signed `q16@0:8` in both compared engines. The selected class specification already uses signed `q`. Session-ID sentinel values, restoration semantics and numeric correspondence to CEF remain unresolved. Original review files are preserved without edits.

All presentation class links resolve. The immutable historical Markdown inventory lists 500 unresolved raw link occurrences, including 412 copied narrative links whose original relative bases were lost, external inputs, source-document crosslinks and directory links. Use the 146-class index and its canonical corrected sources for class evidence; raw histories remain provenance. The publication review inventory classifies these limits and supplies the saved acceptance fixture and source-excerpt locations. The package verifier checks integrity and declared coverage, not link completeness of historical raw Markdown or self-contained research reproduction.
