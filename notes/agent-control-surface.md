# Arc agent-control surface (Arc 1.168.0, Chromium 155.0.8059.40)

Read-only survey, 2026-10-12. Line numbers refer to `dump/swift-types.swift`.

**Current implementation, 2026-10-13:** see [agent-sessions.md](agent-sessions.md).
The old separate-profile launch suggestion below did not establish sidebar
isolation. Agent bundles now isolate by CFBundleName and bundle ID; the current
probe verifies working loopback CDP. Little Arc is absent from AppleScript window
enumeration, and normal windows share sidebar items. Do not use `window 1`, a
matching URL, or a tab UUID alone as a content-ownership handle.

## AppleScript (`resources/Arc.sdef`)

- Objects: `window` (id, name, active tab, active space, incognito, mode, tabs, spaces; no bounds),
  `tab` (id, title, URL [writable → navigates], loading, location [topApp|pinned|unpinned]), `space` (id, title, tabs).
- Commands: make, count, close, select, go back, go forward, reload, stop, `execute … javascript` (returns text), `focus` (space).
- Internally `SharedWindowFeature.WindowAction.AppleScriptAction` (line 78043).
- **Tab/space IDs are sidebar-item UUIDs** (`AppleScriptTabWrapper.tab: BaseModels.SidebarItem`, line 5553) → stable across restarts.
- `tabs of window` spans all spaces.
- Speed: ~70–80 ms per `osascript` launch; inside one long-lived process ≈9 ms per property read, ≈10 ms per JS execution.
- `execute javascript`: result is JSON-serialized, Promises are not awaited (`Promise.resolve(42)` → `{}`), exceptions come back as `null`.
  It ran even though "Allow JavaScript from Apple Events" appears unchecked.
- Missing for agents: screenshots, trusted input, awaitable JS / load events, network, dialogs, file upload, folders/sidebar order, profiles, split view, space creation, window bounds, AppleScript-ID → CDP-target mapping.

## Chrome DevTools Protocol

- ArcCore enforces Chrome 136+'s rule: *"DevTools remote debugging requires a non-default data directory. Specify this using --user-data-dir."*
- Arc honors `--remote-debugging-port` (Swift toast "You must run Arc with --remote-debugging-port=<number>"; `ADKClient.devToolsWebSocketDebugURL`; internal "Copy WebSocket Debug URL" menu).
- No managed policy blocks it (`RemoteDebuggingAllowed` is recognized but not set).
- **Real-profile route (Chrome 144+):** `chrome://inspect#remote-debugging` toggle → pref `devtools.remote_debugging.user-enabled` (currently `false` in Local State) → Arc consent dialog
  (`ADK.ADKApplication.onDevToolsDebuggingRequested`, line 6387; `ArcDevToolsConnectionDialog`). The stale `DevToolsActivePort` (9222, Mar 2026) suggests this was used before.
- Separate-profile launch (quit Arc first):
  `/Applications/Arc.app/Contents/MacOS/Arc --remote-debugging-port=9222 --user-data-dir="$HOME/.arc-agent"`
  (unverified whether the sidebar/login state also relocates).

## Other entry points

- URL schemes: `arcBrowser`, http(s), mailto. `BaseModels.ArcNetURL` (line 22169): document/easel/folder/split/space/browseForMe/quit/restart. Not useful for control.
- None: App Intents, NSServices, extra XPC services, local servers (localhost strings are client endpoints only).
- MV3 extensions work; `chrome.debugger` present.
- Native messaging host `com.anthropic.claude_code_browser_extension.json` is installed, but the matching extension is not installed in Arc.
- `UITestContract.AccessibilityIdentifier` (line 21294): stable accessibility identifiers for Arc's own UI.

## Arc's internal AI/agent stack (no external hook)

- `ADK`/`ADKClient` (line 26266): Swift↔Chromium bridge (`_executeJavaScript`, `_executeJavaScriptViaDevTools`, `createAIService`).
  `ADK.DevTools` (lines 7027–7565) is an in-process CDP client (Runtime.Evaluate, Input.DispatchKeyEvent, Page.Navigate, Network.GetResponseBody, …) over ArcCore's `ArcWebContentsDevTools`.
- `LLM` (line 60214): Claude/ChatGPT/Universal clients with tool calling, via `aiproxy.diabrowser.engineering` / `ai-service.diabrowser.engineering`.
- `AIInfraProtocols` (line 14768): on-device ML (DistilBERT, Nomic embeddings, MLX LLM, command-bar ranking).
- `ASE2` (line 58843): command-bar suggestion engine. `AskArc`: Browse for Me.

## Options

No binary change:
1. Long-lived AppleScript/JXA bridge as a local MCP server (spaces, tabs with stable IDs, navigation, JS reads).
2. CDP: real profile via the inspect toggle + consent, or a separate profile via launch flags; attach with chrome-devtools-mcp / Playwright `connectOverCDP`.
3. MV3 extension with `debugger` + `nativeMessaging` (Claude-in-Chrome pattern): per-tab CDP, trusted input, screenshots, AX tree, no relaunch.
4. Prefer exact CDP page IDs within an isolated session. A sidebar UUID alone
   does not identify independent content across shared windows; writing a
   marker into `window.name` can interfere with page semantics.

Needs patch/injection (re-sign loses keychain groups, CloudKit, push; Sparkle overwrites patches):
- CDP on the default profile without consent; an in-process server mapping sidebar IDs to `ArcWebContentsDevTools` sessions.
