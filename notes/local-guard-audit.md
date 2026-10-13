# Local account-guard audit — Arc 1.168.0 (88413)

Audited 2026-10-13 with read-only agents covering tab/Space operations, window and
Settings actions, and root AppData/startup dispatch. This is a bounded code audit,
not proof that every possible interaction or keyboard customization has passed.

## Confirmed local blockers

| Operation | Native guard | Fix and validation |
|---|---|---|
| Close local tabs | `0x102a3ade8` requires `WindowsData.currentUserID`, derived from `WindowsState.authSession` | Commit `8efd51b`: nil-only native small-String fallback, with unchanged global getters. Loaded normal and incognito tabs close through Cmd+W; Cmd+Shift+T restores an archived tab. |
| Native saved-session window restoration | `0x102ab2f48` requires `WindowsData.isAuthenticated` inside `0x102ab2d6c` | Replace only this branch with NOP after copied-state destruction at `0x102ab2f44`. Native saved-window lookup and missing-data checks stay intact. Binary tests and a fresh ABI/ownership review pass. End-to-end automatic startup restoration remains unverified. |

The second guard consumes `restorableWindows`, which holds AppKit restoration
contexts. The verified emitter is `0x100235908 → 0x10023ed94`, followed by the
AppReducer restoration loop at `0x10011b848/0x10011b84c` emitting WindowsAction case 2.
The earlier interpretation that this was a separate closed-window UI command was
incorrect. Cmd+Shift+T uses `0x1028bdcac` for tab/archive restoration.

Restart testing still opened a fresh window and supplied no demonstrated AppKit
restoration context to this handler. No additional account guard was established
upstream, so removing this guard does not establish complete startup restoration.

## Local paths already supporting absent account state

| Path | Evidence |
|---|---|
| Tab creation | `0x10295ecfc`, `0x10295fcdc` use native UUID fallbacks. |
| Content restoration | `0x1028f903c`, nil branch at `0x1028f9ad8`, construct ordinary WebContent without a user. |
| Back/Forward | `0x1028e5680` checks focused content and native navigation availability. Both shortcuts pass on local A/B pages. |
| Space creation | `0x1029a0404 → 0x1029a1a60`, `0x1029a96cc → 0x1029ab134` check local profile/state. |
| Settings startup | `0x101f5abf0` cleans a nil user and continues common setup at `0x101f5cb80`. |
| Startup restoration dispatch | `0x10023ed94 → 0x10011e7b8 → 0x1003b3e5c` appends restoration context without account rejection. |
| Window state encoding | `0x10031bce0 → 0x10031b7c8` unconditionally writes native NSCoder fields; identifier and logger branches do not reject an absent account. |

Pin/move operations and local window-content reconstruction were checked without
finding another account-dependent rejection. Native new-window, incognito,
close-window and Archive-opening actions also passed live checks.

## Account and service operations preserved

Settings name/delete-account actions (`0x101f585c8`, `0x101f5a4a0`, `0x101f5b114`),
ArcDocument ownership (`0x102982774`), document sharing permissions (`0x10298a20c`)
and the Max Tidy Tab Titles backend effect (`0x1029da0c4`) retain their checks.
An optional user-ID read at `0x102a42998` already accepts nil and needs no patch.

Startup `0x1002357bc` selects a window animation; it is not a permission gate.
`0x100235450` uses preferences/crash policy. Neither was modified.
