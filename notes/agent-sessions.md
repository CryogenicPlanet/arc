# ArcMod agent sessions

Investigation and first implementation, 2026-10-13. Arc 1.168.0 (88413).

## Why agent targeting drifts

Computer Use currently discovers stock Arc and ArcMod as native macOS apps, with
no connected browser-tab provider. Native app observations follow a selected
window; they are not a lease on a particular Chromium page.

Little Arc is `Arc.LittleBrowserWindow : NSPanel`, separate from
`Arc.BrowserWindow : NSWindow`. It can become both key and main. However,
`AppDelegate.appleScriptWindows` filters for BrowserWindow, and
AppleScriptWindowWrapper holds only BrowserWindow. A visible Little Arc can
therefore own native input while `window 1` in scripting identifies a different
full window. The live CUA probe changed from `bigBrowserWindow-5F144279…` to
`littleBrowserWindow-0A4D7EE5…` after File → New Little Arc.

Normal windows also share the global sidebar. `tabs of window` traverses all
sidebar items, not just that window's loaded content. A tab UUID is a sidebar item
ID; selection can reparent underlying content between windows. Two wrappers
with the same tab UUID do not represent independent pages.

Static evidence: `dump/swift-types.swift` lines 1772, 1897, 3536, 3997, 5523,
5553, 24354, 66510, 78043, 79725; native window filter `0x1004506c8` /
BrowserWindow metadata accessor `0x10014e8e4`; tab enumeration `0x100451204`;
Little Arc key/main methods `0x1002c283c` / `0x1002c2844`.

The human mod's requested singleton Little Arc behavior magnifies contention:
every external URL can replace the panel's page. That behavior is preserved for
ordinary ArcMod, but excluded from agent sessions.

## Independent session bundles

Build and launch an agent's fresh session:

```sh
bun tools/build-mod.ts --agent codex
tools/run-mod.sh --agent codex --background --cdp-port 9223
```

Each validated slug gets a separate app, bundle ID, preferences domain and data:

- `build/ArcModAgent-codex.app`
- `company.thebrowser.Browser.mod.agent.codex`
- `~/Library/Application Support/ArcModAgent-codex`

Use a different slug and CDP port for each concurrently active agent. Reuse the
same slug across launches to retain its own browser data. No human profile is
copied, so sessions start signed out. Do not drive multiple agents through one
slug. The builder refuses to replace a running app bundle.
The MCP controller holds an exclusive kernel session lease across setup and
control; the CLI shares that lock. Direct build/launch preflights alone are not
a controller lease. Shared build output is now serialized. Distinct agents should
use distinct slugs.

The Info.plist session marker makes the dylib disable external-links Little Arc,
skip human panel consolidation, redirect the Little Arc menu/shortcut action to
a native full browser window, and display `ARC MOD · <session>` in the sidebar.
Direct native panel creation or restoration outside menu/action dispatch is not
covered by that redirect; agent sessions should use CDP page creation.

For native CUA, bind the exact bundle identity:

```js
let app = await cua.getApp('company.thebrowser.Browser.mod.agent.codex');
```

This separates app/window/sidebar ownership. Native clicks and typing still
have macOS focus constraints; background launch alone does not change that.

## Background page control

The optional debugging endpoint uses Chromium's supported debugging switches
and listens on loopback. Keep it in these fresh agent profiles. Chrome's
[debugging profile guidance](https://developer.chrome.com/blog/remote-debugging-port)
requires a non-default data directory.

Live probe: `--agent probe --background --cdp-port 9223` exposed
Chrome/155.0.8059.40 on `127.0.0.1:9223`, owned by the exact probe app executable.
`Target.createTarget` with `background: true` created a real Arc sidebar tab, and
CUA observed it in a `bigBrowserWindow` with the agent badge. Requesting New Little
Arc in this session also created a full `bigBrowserWindow`. The foreground app
remained unchanged during the initial background launch.

Arc ignores the requested `Agent Chromium Data` path for its actual Chromium
storage: it populated the session's `User Data` directory instead. Isolation is
established by CFBundleName and verified session storage, not by the argument.
The explicit user-data-dir switch was still supplied to satisfy the debugging
launch contract. Earlier notes saying CDP worked were unverified; this probe is
the first evidence for the current mod build.

The CDP CLI uses exact target IDs for page operations and does not select, raise
or activate the page. Target IDs last for the lifetime of the page, so re-list
after a page closes or the browser restarts. Never substitute the first page,
a matching URL, or a sidebar UUID when an ID is stale. Native dialogs remain a
separate app-level surface.

```sh
bun tools/agent-cdp.ts --agent codex --port 9223 list
bun tools/agent-cdp.ts --agent codex --port 9223 open https://example.com
bun tools/agent-cdp.ts --agent codex --port 9223 screenshot TARGET_ID /tmp/page.png
bun tools/agent-cdp.ts --agent codex --port 9223 evaluate TARGET_ID 'document.title'
```

The CLI verifies the loopback listener and its exact agent executable before
connecting. Wrong-session, stock-Arc, missing and closed targets fail instead of
falling back to another window. `evaluate` awaits Promises and reports JavaScript
exceptions. `click` takes CSS viewport coordinates; screenshots have device-pixel
dimensions, so account for `devicePixelRatio` when locating points in an image.
`type` inserts text at the target's focused input.

Hidden Arc tabs initially accepted CDP input requests without delivering events.
Scoped `Emulation.setFocusEmulationEnabled` lets Chromium deliver trusted mouse
and text input without changing macOS foreground focus; the bridge disables
the focus override after each input command. Input can retain renderer/element
focus, which allows a subsequent text command to reach the clicked field.
Screenshot capture and JS
reads do not need focus emulation. This changes the target page's focus/visibility
semantics during input and can trigger its ordinary focus/visibility handlers.

Live regression probe (requires the localhost fixture and an explicitly launched
test agent):

```sh
bun tools/agent-fixture.ts
bun tools/agent-cdp.live-test.ts --agent probe --port 9223
```

The probe creates two disposable page IDs, checks a trusted click and trusted
input in B, checks A remains unchanged, awaits a Promise, captures a PNG, closes
B and verifies its old handle fails, and checks the macOS foreground app stays
unchanged. It closes only its own pages. Results and PNGs are saved under
`profiles/agent-<slug>/`. Session tab/CDP IDs are runtime handles, not durable IDs
across browser restarts.

Final packaged session `codex` also passed the fresh-CLI input probe, including
restored hidden-page visibility, on the signed build. It is running on loopback
port 9223 with its own fresh data. The disposable `probe` app has been stopped.

The [stdio MCP browser tools](computer-use-tools.md) now wrap this endpoint
with exclusive ownership, accessible state, scoped handles and awaited actions.
The Computer Use plugin does not currently auto-discover it as a browser provider.
Native CUA binding and the local CDP bridge are separate interfaces. The MCP adapter
is separately implemented and live-verified; Computer Use provider integration
remains a separate capability.
