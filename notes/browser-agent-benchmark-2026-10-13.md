# Arc and ArcMod browser-work benchmark

Run on October 13, 2026 (Pacific), Arc 1.168.0 (88413), arm64.

ArcMod's **isolated agent sessions through the local CDP bridge** were easier for
background agent work in this run. Two real subagents completed simultaneous
research-and-form tasks without either benchmark app appearing in sampled macOS
foreground state. Ordinary ArcMod through native Computer Use did not establish
an advantage over stock Arc.

## Task and methods

A disposable localhost fixture supplied two fictional export plans. Each agent
had to read both pages, choose the cheapest plan with CSV and at least 30 days of
history, fill plan/price/reason, check the source checkbox, submit, and verify the
saved result. The expected answer was Team, $24, CSV, 90 days. No account, external
submission, external network timing or user data was involved.

- Ordinary ArcMod completed the task through native Computer Use and accessibility
  text entry. Stock Arc's matching native trial was interrupted by concurrent user
  input and the user's request to continue in the background. The native trials
  therefore do **not** support a comparative latency or ease ranking.
- Stock Arc's own disposable inactive tab was then read/navigated and completed
  through AppleScript JavaScript. This worked in the background, using DOM value
  assignment and a scripted button click. `Promise.resolve(42)` returned `{}`:
  the scripting surface did not await the Promise. This was a different input
  method from the ArcMod CDP trials, not a fair browser-speed comparison.
- Fresh `bench-alpha` and `bench-beta` app/data/preferences identities used ports
  9231 and 9232. Each subagent owned one exact target/session and used CDP trusted
  clicks and text insertion; DOM evaluation extracted page facts and verified
  outcomes. Neither used native app activation. Both signed builds passed builder
  ABI probes and deep signature verification; no product source was changed.

## Results

| Trial | Correct saved result | Task wall time |
| --- | --- | --- |
| Stock Arc, native then background scripting | PASS | Not compared |
| Ordinary ArcMod, native Computer Use | PASS | Not compared |
| ArcMod agent alpha, background CDP | PASS | 47.866 s |
| ArcMod agent beta, background CDP | PASS after price correction | 59.613 s |

The two successful agent-task intervals overlapped for 45.089 seconds. Times include
agent reasoning/tool round trips and exclude fixture recovery. They do not measure
Chromium speed or establish a throughput multiplier. Beta initially entered `24`
instead of the fixture's exact `$24` and corrected it with trusted input.

Both agents' recorded click/input/submit events were trusted. Both retained their
own values in identically named same-origin localStorage and cookie keys after
both writes and another navigation. Manipulating/closing a second hidden target
left each main task unchanged; calls to closed target IDs failed. Parent probes
also rejected each agent's target through the other endpoint and rejected the
wrong slug/port combination.

Foreground sampling ran at a target interval of 250 ms, including startup and
agent work. Across 1,200 samples, neither benchmark app appeared; the user continued using other apps.
This is sampled evidence and can miss a transition shorter than the interval.
Both task screenshots were inspected and showed the correct fields, checked
source box and saved PASS. Async CDP evaluation returned the awaited value.

## Friction and limits

The first parallel attempt stalled because the test fixture used single-thread
HTTPServer and was starved by idle browser connections. Parent changed only the
ignored fixture to ThreadingHTTPServer, confirmed HTTP responses, and restarted
measurements once usable. Initial blank targets and timeouts are confounded by
that fixture failure and are not attributed to ArcMod.

The CDP bridge resets focus emulation after each input, but renderer `hasFocus()`
changed false to true and task visibility was visible because each task was its
session's selected page. The macOS apps remained background in the samples. Thus
native foreground preservation does not imply unchanged DOM focus semantics.

The practical gain comes from separate app/profile ownership, exact target IDs,
trusted background input, awaited JavaScript, and screenshots. It requires the
agent session + CDP bridge: Computer Use still discovers stock Arc and ordinary
ArcMod only as native apps. This does not establish that stock Arc cannot support
CDP, or that ordinary ArcMod is faster. Two fresh local signed-out sessions are
not evidence for large-scale concurrency, logged-in workflows, file uploads or
native permission/dialog handling. A browser-provider adapter would make this
control surface more convenient to use directly from Computer Use.

Raw fixture, command timings, event reports, foreground samples and screenshots
are local, ignored files under `scratchpad/browser-benchmark/`. Existing unrelated
README/package/importer edits were left alone. No browser rebuild/restart of the
human Arc or ordinary ArcMod app was needed.

Cleanup verified: neither normal browser retained a localhost benchmark tab; both
fresh agent apps were stopped after their exact targets closed. The server was
stopped. Test-only generated session bundles/data remain local and ignored.
