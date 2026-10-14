# ArcMod browser tools

Implemented October 13, 2026 for Arc 1.168.0 (88413), arm64. The local `arcmod`
stdio MCP server is registered in this machine's Codex configuration. Its 15 tools
are available when a client loads that configuration; this does not replace or
add a browser provider to the Computer Use plugin. The adapter was verified over
real MCP stdio, separately from the configuration readback.

## Use

The server starts without opening a browser. Call `open_session` with no arguments
to build and launch a fresh, isolated background agent app. It returns a session
handle. Use that handle with `open_tab`, then use page/element handles returned by
the tools. Each state refresh invalidates earlier element handles.

Tools: `open_session`, `close_session`, `list_tabs`, `open_tab`, `read_page`,
`screenshot`, `navigate`, `back`, `forward`, `click`, `type`, `wait_for`, `close_tab`,
`native_state`, `native_action`.

`read_page` returns AX roles, accessible names, values, checked/disabled/focusable
states, parent/child AX IDs, actionable element handles, viewport bounds and page
text. Password values are redacted. Text and node-count truncation are explicit.
Click/type use exact DOM backend nodes, validate current geometry/hit testing,
and send trusted Chromium input without activating macOS apps. Typing replaces
and verifies the value by default; `replace:false` appends. A stale snapshot,
foreign handle, detached or obscured element fails instead of finding a substitute.
Iframe controls are not yet supported by the main-frame AX snapshot.

Navigation waits for the requested main document's loader and execution context.
Clicks return observed state after immediate navigation; delayed site effects
need an explicit `wait_for` text/URL/role/name condition. Use `wait_for` for async
submission or UI transitions. A timeout never automatically replays an input.
Screenshots return native MCP PNG image blocks plus CSS viewport, pixel dimensions
and device-pixel ratio. They require no screenshot path or shell command.

`native_state` inspects only the exact agent process, excludes web-area children,
and returns identifiers, labels, values, advertised actions and an unlabeled-press
control audit. Its handles also expire on refresh. `native_action` accepts only
`press` or a settable `value` from an observed handle and validates its current
fingerprint. It has no keyboard/global-selector fallback. Native UI may itself
change focus when a native action is requested; page tools stay background.
Unavailable macOS accessibility access returns a clear error without prompting.

Native labels prefer nonempty title/description/help, with readable names for
known identifiers and standard window-button subroles. The mod-owned sidebar
badge now has an explicit AX group, session label and identifiers. This is a
bounded native improvement, not a claim that every Settings/dialog control is
fully audited or fixed. Further UI workflows can be inspected through these tools.

## Ownership and lifecycle

One cooperative controller owns an agent slug through a kernel `flock` held for
its session lifetime. The CLI uses the same lock. A second controller fails;
different slugs proceed independently. OS process death releases the lock even
after SIGKILL. Lock files are private, retained in `~/.arcmod/leases`, and never
unlinked/replaced during reclamation. Direct/raw CDP users can bypass this
cooperative lock; it is not CDP authentication.

The server allocates distinct bundle/profile/preference identities and loopback
ports. Build output is serialized because headers/dylib are shared. A PID/slug
readiness record is published by the native module after a real sidebar exists;
opening a CDP listener alone is insufficient for cold-start page creation.
Failed setup cleans up the app it launched and releases ownership. Server exit
stops only apps it launched; explicitly attached apps remain running. A timed-out
close retains ownership and reports that shutdown is pending.

For an existing updated bundle, call `open_session` with explicit `agent`, `port`,
and `attach:true`. Old bundles without the readiness marker need rebuilding.
Requests are serialized within a session, while independent sessions and MCP
processes can run concurrently. Handles never survive server/browser restarts.

Register elsewhere using absolute paths:

```sh
codex mcp add arcmod -- /absolute/path/to/bun /absolute/path/to/arc/tools/agent-mcp.ts
```

## Verification

Require `bin/Arc.arm64` and run the source checks described in README. The new
ownership, stale-handle, loader-readiness, MCP framing and argument tests are in
`tools/agent-control.test.ts` and included in `bun run test`.

Opt-in end-to-end checks:

```sh
bun tools/agent-control-fixture.ts
# another terminal
bun tools/agent-control.live-test.ts
```

The live test starts two isolated signed agent test apps using separate actual stdio MCP
clients, checks accessible discovery, trusted text/click/submission, a delayed
result, delayed navigation, back/forward, redacted password state, screenshots, empty append/replacement,
native state/session badge, stale native handles, competing CLI ownership and
foreign/closed page handles. It samples foreground state during the run and
stops its own agents on completion. Output goes to ignored `profiles/agent-control`.

Latest successful run: both workflows passed concurrently, 240 foreground samples
and zero agent foreground observations. Both native trees were available and
contained correctly labeled session badges. Screenshots were inspected. The first
cold-start test crashed one new agent before native window readiness; the explicit
readiness barrier preceded two successful reruns. This is evidence for the tested
local workflows, not arbitrary website, dialog or large-scale concurrency support.

Typecheck and lint pass. The complete current suite passed with stable Bun 1.4.3:
48 core tests plus the concurrent-workspace shortcut tests, service/shortcut native
policy checks and binary source present. The installed old Bun 1.4.0 canary's test
runner intermittently failed subprocess pipes with EBADF even in a minimal test
without ArcMod imports. Stable Bun was downloaded only to ignored scratchpad for
verification; the global Bun installation was preserved. Production MCP stdio
live checks passed using the installed Bun.
