# ArcMod shortcut audit — 2026-10-13

Target: Arc 1.168.0 (88413), arm64. Normal ArcMod was rebuilt, ad-hoc signed and checked through Computer Use with disposable localhost pages. Original Arc and its profile were untouched.

## Finding and fix

The old inventory covered only 89 registered NIB binding IDs. It omitted 73 additional menu actions, including ordinary Copy. The complete NIB inventory now contains 162 actions. Native generated builders add 19 registered window commands, two unregistered alternates, and the dynamic Space selection family.

Added 18 exact local selectors to the existing policy. This resumes native validation and dispatch at the existing nil-session bridge; it preserves window/profile/content checks, native ownership and security preference checks. No new binary patch or global authentication change was needed. Standard text shortcuts keep their AppKit/Chromium responder ownership.

| Fixed case | Selector | Verification |
|---|---|---|
| Space selection | focusSpace: | Finite native Space action; same-Space menu enabled/selected; cross-Space transition not exercised. |
| Space rename | renameFocusedSpace: | Native rename sheet; cancelled. Fresh-launch first-dialog retest passed. |
| Space theme | editSpaceTheme: | Native color popover; cancelled. |
| Space profile | changeProfileForCurrentSpace: | Native change-profile sheet; cancelled. |
| New profile | newProfile: | Native naming sheet; cancelled before creation. |
| Pinned section expand | expandPinnedSection: | Pinned section returned to baseline. |
| Pinned section collapse | collapsePinnedSection: | Pinned Arc Basics folder hidden. |
| Media | viewScreenshotsAndCaptures: | Native Media library opened. |
| Task Manager | openTaskManager: | Native Task Manager window opened. |
| Manage extensions | navigateToChromeExtensionsPage: | chrome://extensions/ opened. |
| Add extension | navigateToChromeWebStore: | Chrome Web Store destination verified; no installation. |
| Shortcut help | keyboardShortcutsEDU: | Native Essential Keyboard Shortcuts window opened. |
| Copy diagnostics | copyArcInfo: | Populated diagnostic clipboard; contents omitted; restored fixture URL. |
| Reveal data | revealArcData: | ArcMod Finder window opened; closed only created window. |
| Restore data | presentRestoreDataFlow: | Native Restore Data window opened; no restore applied. |
| Getting Started | showWelcomeToArc: | Native Getting Started tab opened. |
| Privacy | showPrivacyPolicy: | https://arc.net/privacy/ destination verified; vendor-content filtering retained. |
| Apple Events JavaScript | allowJavascriptFromAppleEvents: | Enabled menu admission; native permission/profile validator preserved. Security opt-in not toggled. |

## Live regression cases

The 72 rows below are context/action checks, including repeated chords in different contexts. A dialog opening verifies dispatch; it does not establish every operation inside that dialog.

Run the disposable fixture with `bun tools/shortcut-fixture.ts`; use only its localhost tabs for editing, navigation, splits and close/reopen checks.

| Context | Shortcut or command | Observed result |
|---|---|---|
| Web input | Cmd+X | Removed beta; clipboard equals beta. |
| Web input | Cmd+V | Restored alpha beta gamma |
| Web input | Cmd+Z | Undid paste |
| Web input | Shift+Cmd+Z | Redid paste |
| Web input | Cmd+A | Selected entire field |
| Web input | Cmd+C | Copied page input; multiline paste matches |
| Web input | Option+Shift+Cmd+V | Inserted plain clipboard into multiline |
| Command bar | Cmd+X | Selected beta; cut/paste/undo/redo values checked; full selection copied. |
| Command bar | Cmd+V | Selected beta; cut/paste/undo/redo values checked; full selection copied. |
| Command bar | Cmd+Z | Selected beta; cut/paste/undo/redo values checked; full selection copied. |
| Command bar | Shift+Cmd+Z | Selected beta; cut/paste/undo/redo values checked; full selection copied. |
| Command bar | Cmd+A | Selected beta; cut/paste/undo/redo values checked; full selection copied. |
| Command bar | Cmd+C | Selected beta; cut/paste/undo/redo values checked; full selection copied. |
| Command bar | Shift+Cmd+V | Replaced test text with known clipboard value. |
| Command bar | Cmd+Left | Caret moved to start; Shift+Right selected c without page navigation. |
| Find | Cmd+F | ORCHID-AUDIT found 1/3. |
| Find | Cmd+G | Advanced to 2/3. |
| Find | Shift+Cmd+G | Returned to 1/3. |
| Browser | Cmd+[ | Back B→A |
| Browser | Cmd+] | Forward A→B |
| Browser | Cmd+R | Load marker 4→5 |
| Browser | Shift+Cmd+R | Load marker 5→6 |
| Browser | Cmd+= | Visible 110% zoom indicator |
| Sidebar | Cmd+S | Sidebar displayed. |
| Library | Shift+Cmd+J | Downloads library opened and closed. |
| Library | Cmd+Y | chrome://history Search history opened; audit tab restored after close. |
| Tabs | Cmd+T | Created localhost A tab. |
| Tabs | Cmd+W | Closed A and returned to B. |
| Tabs | Shift+Cmd+T | Reopened A. |
| Tabs | Ctrl+Tab | Moved A to B. |
| Tabs | Option+Cmd+Up | Selected A from B. |
| Tabs | Option+Cmd+Down | Selected B from A; subsequent tools target B. |
| Tools | Option+Cmd+I | DevTools Elements panel. |
| Tools | Option+Cmd+J | DevTools Console panel. |
| Tools | Cmd+P | Print preview appeared; cancelled. |
| Tools | Shift+Cmd+S | Save panel appeared; cancelled. |
| Tools | Option+Cmd+U | Fixture source opened in separate tab. |
| Tools | Cmd+comma | Settings General window appeared. |
| Windows | Cmd+N | New ordinary window UUID; fixture A loaded. |
| Windows | Shift+Cmd+W | Closed audit window; original window B restored. |
| Repaired menu | Essential Keyboard Shortcuts | Native shortcut help window opened. |
| Repaired menu | Open Task Manager | Task Manager native window opened. |
| Repaired menu | Manage Extensions | chrome://extensions opened. |
| Repaired menu | Edit Theme | Native Space color popover opened; cancelled. |
| Repaired menu | Change Profile | Native Space profile sheet opened; cancelled. |
| Repaired menu | New Profile | Native naming sheet opened; cancelled. |
| Repaired menu | Restore Data | Native restore window opened; no restore performed. |
| Split | Ctrl+Shift+= | Fixture A added alongside B; both HTML panels visible. |
| Split | Ctrl+Shift+- | Focused A pane closed; B remained. |
| Sidebar | Cmd+D | B moved to pinned section; second invocation restored unpinned position. |
| Repaired menu | Collapse/Expand Pinned Tabs | Arc Basics hidden then restored. |
| URL | Cmd+L → Cmd+C | After signed rebuild, clipboard equals full localhost B URL. |
| Repaired menu | Copy Arc Info | Diagnostic clipboard populated; contents not logged; restored known URL. |
| Repaired menu | Getting Started | Native Getting Started tab opened; closed. |
| Little Arc | Option+Cmd+N | Little Arc window loaded localhost A. |
| Little Arc | Cmd+L → Cmd+C | Clipboard equals localhost A URL. |
| Little Arc | Cmd+W | Closed only Little Arc and returned to main B. |
| Repaired menu | Rename Space | Native Rename/Cancel sheet from commandbar and subsequent menu attempt; initial menu no-op unreproduced. |
| Repaired menu | Add Extension | Navigated to https://chromewebstore.google.com/category/extensions; no install. |
| Repaired menu | Privacy Policy | URL https://arc.net/privacy/; service-filtered content not a navigation test. |
| Repaired menu | Reveal Arc Data | Opened Finder window ArcMod; closed only created window. |
| Repaired menu | View Media | Native Search Media library and empty-media placeholder. |
| Library | Shift+Cmd+L | Library opens/closes; local Downloads/Media controls. |
| Windows | Shift+Cmd+N | Incognito window UUID; localhost A loaded then audit window closed. |
| Rich text | Cmd+B / Cmd+I / Cmd+U | Fixture reports Bold true / Italic true / Underline true after modifier release; no shortcut policy change. |
| Spelling | Shift+Cmd+semicolon | Native Spelling and Grammar floating window; closed. |
| Spelling | Cmd+semicolon | Selected disposable misspelling zzqqshortcut after caret moved to start. |
| Tabs | Cmd+2 | Changed active fixture B to A. |
| Tabs | Cmd+1 | Returned to first fixture B. |
| Tabs | Shift+Cmd+[ | Runtime previous-tab alternate: A to B. |
| Tabs | Shift+Cmd+] | Runtime next-tab alternate: B to A. |
| Repaired menu | Rename Space after fresh launch | Opened native Rename/Cancel sheet as first dialog after fresh restart; no name changed. |

## Context and verification limits

- Find and Replace and Jump to Selection use native Find tags unsupported on ordinary web pages. Find Next/Previous require find state; Use Selection requires a nonempty selection.
- Cmd+Left/Right retain caret navigation in focused text editors. Cmd+J is contextual Jump to Selection; Downloads uses Shift+Cmd+J.
- Bold/Italic menu entries can be disabled by NSFontManager while the website receives the keyboard chord. In the fixture, Chromium produced bold, italic and underline formatting successfully.
- NIB accelerators are declarations. Native KeyBindingMenuManager applies current valid/conflict/unset preferences. Live Settings exposes alternate previous/next tab as Cmd+{ / Cmd+}; those passed. Old Ctrl+Cmd+arrow cycle declarations produced no tab change and are absent from current Settings. They are not treated as active runtime bindings or used to overwrite user preferences.
- Direct selection of the existing Space passed menu admission; multiple-Space switching was not exercised. Profile creation/change, data restore, Clear Today/Archive, cookie clearing and Space resets were not applied to user data. These retain source/native classifier checks rather than destructive end-to-end claims.
- Fullscreen/minimize/hide, capture/export/share/cast and every combination of pane/Space indices were not independently exercised. Native feature, permission and target-context checks remain applicable.
- The first Rename Space menu attempt after a rebuild was a no-op. Subsequent command-bar and menu attempts opened the native sheet; a fresh-launch first-dialog retest also passed. Both routes reach the same dialog builder. No further account guard was found; native WindowProvider validity checks remain intact. The initial transient cause is unproven.
- Automatic startup restoration remains the separate known regression in runtime-status.md. This audit does not resolve it.
- Audit tabs, windows and localhost server were cleaned up. Current human browsing state was left active.

## Regression prevention

`tools/shortcut-inventory.ts` reads the NIB without instantiating objects, records every actionable item (including unbound wrappers), and pins source SHA256 and Arc version/build. `tools/shortcut-coverage.ts` requires explicit local or native/service routing for every item, both selector and registered callback coverage for local NIB actions, and finite dynamic Space admission. Unknown actions and accidental service admission fail checks.

`resources/shortcut-generated-inventory.json` separately records generated numbered tabs, pane selection, alternate tab navigation, extension picker and Little Arc move-menu actions. Five binary fingerprints pin their builders/native validators. Native BrowserWindow/LittleBrowserWindow actions keep native ownership; arbitrary item/pane/space callback prefixes remain denied.

Both `bun run test` and the builder invoke coverage verification. The build fails before rewriting the output bundle if NIB or generated native functions drift. Native classifier tests exercise every allowed selector and reject unavailable services and generated-style callback IDs.

Typecheck, lint and the full test pipeline passed with `bin/Arc.arm64` present. Bun canary raised EBADF when test files were supplied as bare paths; explicit `./`/absolute paths passed. The package runner uses explicit paths while preserving concurrent importer/agent-test additions. Signed-app verification passed, followed by the live cases above. Fresh read-only review covered the policy and inventory changes.

## Complete generated command list

The two unregistered alternates duplicate existing local selectors. Space commands use native SpaceID represented objects and bounded native index registration. Overrides supersede declared keys.

| ID or family | Selector | Declared chord | Owner | Route |
|---|---|---|---|---|
| item1 | switchToTab: | Cmd+1 | Arc.BrowserWindow | nativeWindow |
| item2 | switchToTab: | Cmd+2 | Arc.BrowserWindow | nativeWindow |
| item3 | switchToTab: | Cmd+3 | Arc.BrowserWindow | nativeWindow |
| item4 | switchToTab: | Cmd+4 | Arc.BrowserWindow | nativeWindow |
| item5 | switchToTab: | Cmd+5 | Arc.BrowserWindow | nativeWindow |
| item6 | switchToTab: | Cmd+6 | Arc.BrowserWindow | nativeWindow |
| item7 | switchToTab: | Cmd+7 | Arc.BrowserWindow | nativeWindow |
| item8 | switchToTab: | Cmd+8 | Arc.BrowserWindow | nativeWindow |
| item9 | switchToTab: | Cmd+9 | Arc.BrowserWindow | nativeWindow |
| pane1 | switchToWindowContent: | Ctrl+Shift+1 | Arc.BrowserWindow | nativeWindow |
| pane2 | switchToWindowContent: | Ctrl+Shift+2 | Arc.BrowserWindow | nativeWindow |
| pane3 | switchToWindowContent: | Ctrl+Shift+3 | Arc.BrowserWindow | nativeWindow |
| pane4 | switchToWindowContent: | Ctrl+Shift+4 | Arc.BrowserWindow | nativeWindow |
| switchToNextWindowPane | switchToNextWindowContent: | Ctrl+Shift+] | Arc.BrowserWindow | nativeWindow |
| switchToPreviousWindowPane | switchToPreviousWindowContent: | Ctrl+Shift+[ | Arc.BrowserWindow | nativeWindow |
| nextTab | nextTab: | Cmd+} | Arc.BrowserWindow | nativeWindow |
| previousTab | previousTab: | Cmd+{ | Arc.BrowserWindow | nativeWindow |
| openExtensionsPicker | toggleOpenExtensions: | Cmd+E | Arc.BrowserWindow | nativeWindow |
| showLittleArcOpenInMenu | toggleMoveMenu: | Shift+Cmd+O | Arc.LittleBrowserWindow | nativeWindow |
| space<N> | focusSpace: | Ctrl+N for indexed entries N<10; native overrides supersede | Arc.MainWindowController | localFinitePolicy |
| unregistered alternate | pasteAsPlainText: | Option+Shift+Cmd+V | native responder chain | localFinitePolicy |
| unregistered alternate | toggleFullScreen: | native modifier mask 8388608 | native responder chain | localFinitePolicy |

## Complete NIB action list

Route counts: 108 local-policy, 26 native text/formatting responders, 5 native system, 3 native appearance, 2 native diagnostics, 13 service/integration, 5 unavailable backend features. Classification is distinct from a live pass. Key labels preserve source characters and Shift implied by uppercase; current Settings/runtime menus take precedence.

| Action | Selector | NIB chord | Binding ID | Route |
|---|---|---|---|---|
| Boost Gallery | openBoostGallery: | — | — | serviceOrIntegration |
| Show/Hide Sidebar | toggleArcSidebar: | Cmd+s | showSidebar | local-policy |
| New ChatGPT Message… | gptMessage: | Alt+Cmd+g | gptMessage | local-policy |
| Go Forward | navigateTabForward: | Cmd+] | goForward | local-policy |
| Cancel Trace | cancelTrace: | — | — | nativeDiagnostics |
| Change Profile | changeProfileForCurrentSpace: | — | — | local-policy |
| Zoom Out | zoomOut: | Cmd+- | zoomOut | local-policy |
| Visit Help Center | visitHelpCenter: | — | — | serviceOrIntegration |
| About Arc | orderFrontStandardAboutPanel: | — | — | nativeSystem |
| Redo | redo: | Shift+Cmd+Z | — | nativeResponder |
| Collapse All Folders | collapseAllFolders: | — | collapseAllFolders | local-policy |
| Rename Current Item | rename: | — | rename | local-policy |
| View Downloads | toggleDownloads: | Shift+Cmd+J | viewDownloads | local-policy |
| Expand All Folders | expandAllFolders: | — | expandAllFolders | local-policy |
| Cycle Tab Backward | cycleTabBackward: | Ctrl+Cmd+ | cycleTabBackward | local-policy |
| Pin/Unpin Tab | toggleSelectedItemsPinned: | Cmd+d | pinTab | local-policy |
| Add Split View | addSplitPanel: | Ctrl+Shift+= | addSplitView | local-policy |
| Tab Switcher (backward) | cycleToPreviousRecentTab: | Ctrl+Shift+ | cyclePreviousTab | local-policy |
| Peek Email… | peekEmail: | Shift+Cmd+E | peekEmail | unavailable-feature |
| Close this Split Pane | closeFocusedSplitViewPanel: | Ctrl+Shift+- | removeSplitView | local-policy |
| Open Command Bar | toggleOpenOmnibox: | Cmd+l | addressBar | local-policy |
| Set as Default Browser | setAsDefaultBrowser: | — | — | nativeSystem |
| Capture… | capturePage: | Shift+Cmd+2 | capturePage | local-policy |
| Record Trace | recordTrace: | — | — | nativeDiagnostics |
| Developer Tools | toggleDevTools: | Cmd+ | developerTools_Alternate | local-policy |
| Show Spelling and Grammar | showGuessPanel: | Cmd+: | — | nativeResponder |
| Dark | setDarkAppearance: | — | — | nativeAppearance |
| Essential Keyboard Shortcuts | keyboardShortcutsEDU: | — | — | local-policy |
| Reset all tabs in this Space | resetVisiblePinnedTabs: | — | resetSpace | local-policy |
| Show All | unhideAllApplications: | — | — | nativeSystem |
| Privacy Policy | showPrivacyPolicy: | — | — | local-policy |
| Go Back | navigateTabBackArrow: | Cmd+ | goBack_Alternate | local-policy |
| Open Task Manager | openTaskManager: | — | — | local-policy |
| New Profile | newProfile: | — | — | local-policy |
| Copy URL as Markdown | copyCurrentURLAsMarkdown: | Alt+Shift+Cmd+C | copyCurrentURLMarkdown | local-policy |
| Edit Boost | editBoost: | — | — | serviceOrIntegration |
| Enter/Exit Full Screen | toggleFullScreen: | Ctrl+Cmd+f | fullscreen | local-policy |
| Rename Space | renameFocusedSpace: | — | — | local-policy |
| View Library | toggleLibrary: | Shift+Cmd+L | viewLibrary | local-policy |
| New Little Arc Window | newLittleBrowserWindow: | Alt+Cmd+n | showLittleArc | local-policy |
| Hide Arc | hide: | Cmd+h | hideArc | local-policy |
| Find Previous | arc_performFindPanelAction: | Shift+Cmd+G | findPrevious | local-policy |
| Clear Unpinned Tabs | clearExplore: | Shift+Cmd+K | clearExplore | local-policy |
| Stop Loading | stopLoadingCurrentTab: | Cmd+. | stopLoading | local-policy |
| Network Inspector | networkInspector: | — | networkInspector | local-policy |
| Select All | selectAll: | Cmd+a | — | nativeResponder |
| Jump to Selection | arc_performFindPanelAction: | Cmd+j | jumpToSelection | local-policy |
| Manage Spaces… | toggleSpaceManager: | — | openSpaceManager | local-policy |
| Duplicate | duplicate: | — | duplicate | local-policy |
| Close Window | closeWindow: | Shift+Cmd+W | closeWindow | local-policy |
| Copy Arc Info | copyArcInfo: | — | — | local-policy |
| Reveal Arc Data | revealArcData: | — | — | local-policy |
| Share… | share: | — | share | local-policy |
| Expand Pinned Section | expandPinnedSection: | — | — | local-policy |
| Expand Current Split | maximizeCurrentSplitViewPane: | — | — | local-policy |
| Automatic | setAutomaticAppearance: | — | — | nativeAppearance |
| View Source | viewSource: | Alt+Cmd+u | viewSource | local-policy |
| View Media | viewScreenshotsAndCaptures: | — | — | local-policy |
| New Window | newWindow: | Cmd+n | newWindow | local-policy |
| New Note | newNote: | Ctrl+Shift+N | newNote | unavailable-feature |
| Refresh the Page | reloadPage: | Cmd+r | reloadPage | local-policy |
| Restore Last Closed Tab | reopenLastTab: | Shift+Cmd+T | reopenLastClosedTab | local-policy |
| Hide Other Windows | hideOtherApplications: | Alt+Cmd+h | hideOthers | local-policy |
| Paste and Match Style | pasteAsPlainText: | Shift+Cmd+V | pasteAndMatchStyle | local-policy |
| Reveal Tab in Sidebar | revealCurrentTabInSidebar: | — | revealTabInSidebar | local-policy |
| Zoom to Actual Size | resetZoom: | Cmd+0 | resetZoom | local-policy |
| Reveal Current Tab | focusSidebar: | Ctrl+  | focusSidebar | local-policy |
| Getting Started | showWelcomeToArc: | — | — | local-policy |
| Find… | arc_performFindPanelAction: | Cmd+f | find | local-policy |
| Next Space | nextSpace: | Alt+Cmd+ | focusNextSpace | local-policy |
| Find and Replace | arc_performFindPanelAction: | Alt+Cmd+f | findAndReplace | local-policy |
| New Tab… | newWindowForTab: | Cmd+t | newTab | local-policy |
| Collapse Pinned Section | collapsePinnedSection: | — | — | local-policy |
| Previous Tab | previousTab: | Alt+Cmd+ | selectPreviousTab | local-policy |
| View Boosts | viewBoosts: | — | — | serviceOrIntegration |
| Cycle Tab Forward | cycleTabForward: | Ctrl+Cmd+ | cycleTabForward | local-policy |
| New Boost | newBoost: | — | — | serviceOrIntegration |
| Copy URL | copyCurrentURL: | Shift+Cmd+C | copyCurrentURL | local-policy |
| Print | printPage: | Cmd+p | printPage | local-policy |
| Capture in Portrait Mode | capturePrettyScreenshot: | — | capturePrettyScreenshot | local-policy |
| Use Selection to Find | arc_performFindPanelAction: | — | useSelectionForFind | local-policy |
| View Archive | showArchive: | — | viewArchive | local-policy |
| Go Back | navigateTabBack: | Cmd+[ | goBack | local-policy |
| New Folder… | newList: | Shift+Cmd+N | newFolder | local-policy |
| Archive Tab | closeCurrentItem: | Cmd+w | archiveTab | local-policy |
| Manage Extensions… | navigateToChromeExtensionsPage: | — | — | local-policy |
| Quit Arc | userQuitApp: | Cmd+q | quitArc | local-policy |
| Minimize Window | performMiniaturize: | Cmd+m | minimize | local-policy |
| Preferences… | showPreferences: | Cmd+, | viewPreferences | local-policy |
| Tab Switcher (forward) | cycleToNextRecentTab: | Ctrl+	 | cycleNextTab | local-policy |
| New Incognito Window | newIncognitoWindow: | Shift+Cmd+N | newIncognitoWindow | local-policy |
| Force Refresh the Page | forceReloadPage: | Shift+Cmd+R | forceReloadPage | local-policy |
| Zoom In | zoomIn: | Cmd++ | zoomIn | local-policy |
| Export Arc Notes | exportArcNotes: | — | — | serviceOrIntegration |
| Paste | paste: | Cmd+v | — | nativeResponder |
| Clear Cache and Refresh | clearCacheAndRefresh: | — | — | local-policy |
| Show/Hide Toolbar | toggleArcToolbar: | Shift+Cmd+D | toggleToolbar | local-policy |
| Previous Space | previousSpace: | Alt+Cmd+ | focusPreviousSpace | local-policy |
| Light | setLightAppearance: | — | — | nativeAppearance |
| Join Meeting | joinLiveMeeting: | Ctrl+Cmd+j | joinLiveMeeting | unavailable-feature |
| View History | showAllHistory: | Cmd+y | viewHistory | local-policy |
| Send to Dia | sendCurrentTabToDia: | — | — | serviceOrIntegration |
| Clear Archive | clearArchive: | — | clearArchive | local-policy |
| New Legacy Boost (Advanced) | newLegacyBoost: | — | — | serviceOrIntegration |
| New Space… | newSpace: | — | newSpace | local-policy |
| Save Page As | save: | Shift+Cmd+S | savePageAs | local-policy |
| New Note (in Split) | newNoteInSplitView: | Ctrl+Alt+n | newNoteInSplitView | unavailable-feature |
| Add Extension… | navigateToChromeWebStore: | — | — | local-policy |
| Capture Full Page | captureFullPage: | — | captureFullPage | local-policy |
| Find Next | arc_performFindPanelAction: | Cmd+g | findNext | local-policy |
| New Easel | newEasel: | Ctrl+Shift+E | newEasel | unavailable-feature |
| Toggle Developer Mode | toggleDeveloperMode: | Ctrl+d | toggleDeveloperMode | local-policy |
| Contact the Team | contactTheTeam: | — | — | serviceOrIntegration |
| Separate Page from Split View | separateTabFromSplitView: | — | separateTabFromSplitView | local-policy |
| JavaScript Console | javaScriptConsole: | Alt+Cmd+j | javaScriptConsole | local-policy |
| Exit | exit: | Cmd+ | exit | local-policy |
| Check for Updates… | checkForUpdates: | — | — | serviceOrIntegration |
| Reset Tab to Original URL | resetTab: | — | resetTab | local-policy |
| Release Notes | onSelectResource_releaseNotes: | — | — | serviceOrIntegration |
| Cast | cast: | — | cast | local-policy |
| Inspect Elements | inspectElements: | Alt+Cmd+c | inspectElements | local-policy |
| Cut | cut: | Cmd+x | — | nativeResponder |
| Next Tab | nextTab: | Alt+Cmd+ | selectNextTab | local-policy |
| Copy URL as Quote | copyCurrentURLAsQuote: | Ctrl+Shift+Cmd+C | copyCurrentURLAsQuote | local-policy |
| Edit Theme… | editSpaceTheme: | — | — | local-policy |
| Clear Cookies and Refresh | clearCookiesAndRefresh: | — | clearCookies | local-policy |
| Go Forward | navigateTabForwardArrow: | Cmd+ | goForward_Alternate | local-policy |
| Copy | copyAction: | Cmd+c | — | local-policy |
| Developer Tools | toggleDevTools: | Alt+Cmd+i | developerTools | local-policy |
| Blank Window | blankWindow: | Ctrl+Cmd+n | newBlankWindow | local-policy |
| Open Little Arc or Peek in… | openInCurrentSpace: | Cmd+o | openTabIn | local-policy |
| Restore Data | presentRestoreDataFlow: | — | — | local-policy |
| View Easels & Notes | viewEaselsAndNotes: | — | — | serviceOrIntegration |
| New Tab… | newWindowForTab: | Cmd+t | — | local-policy |
| Zoom | performZoom: | — | — | nativeSystem |
| Bring All to Front | arrangeInFront: | — | — | nativeSystem |
| Sign Out | signOut: | — | — | serviceOrIntegration |
| Correct Spelling Automatically | toggleAutomaticSpellingCorrection: | — | — | nativeResponder |
| Smart Copy/Paste | toggleSmartInsertDelete: | — | — | nativeResponder |
| Underline | underline: | Cmd+u | — | nativeResponder |
| Text Replacement | toggleAutomaticTextReplacement: | — | — | nativeResponder |
| Bold | addFontTrait: | Cmd+b | — | nativeResponder |
| Stop Speaking | stopSpeaking: | — | — | nativeResponder |
| Zoom Out | zoomOut: | Shift+Cmd+- | — | local-policy |
| Delete | delete: | — | — | nativeResponder |
| Capitalize | capitalizeWord: | — | — | nativeResponder |
| Start Speaking | startSpeaking: | — | — | nativeResponder |
| Smart Links | toggleAutomaticLinkDetection: | — | — | nativeResponder |
| Make Lower Case | lowercaseWord: | — | — | nativeResponder |
| Undo | undo: | Cmd+z | — | nativeResponder |
| Smart Quotes | toggleAutomaticQuoteSubstitution: | — | — | nativeResponder |
| Check Document Now | checkSpelling: | Cmd+; | — | nativeResponder |
| Allow JavaScript from Apple Events | allowJavascriptFromAppleEvents: | — | — | local-policy |
| Check Grammar With Spelling | toggleGrammarChecking: | — | — | nativeResponder |
| Zoom In | zoomIn: | Cmd+= | — | local-policy |
| Zoom In | zoomIn: | Cmd+= | — | local-policy |
| Check Spelling While Typing | toggleContinuousSpellChecking: | — | — | nativeResponder |
| Smart Dashes | toggleAutomaticDashSubstitution: | — | — | nativeResponder |
| Data Detectors | toggleAutomaticDataDetection: | — | — | nativeResponder |
| Make Upper Case | uppercaseWord: | — | — | nativeResponder |
| Italic | addFontTrait: | Cmd+i | — | nativeResponder |
| Show Substitutions | orderFrontSubstitutionsPanel: | — | — | nativeResponder |
