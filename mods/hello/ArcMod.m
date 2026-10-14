// ArcMod's required in-process local-mode module. Account/session data stays unchanged.
// It disables service preferences, filters native service requests, permits local browser
// commands, adds the requested sidebar marker and retains one Little Arc window.

#import <AppKit/AppKit.h>
#import <mach-o/dyld.h>
#import <objc/runtime.h>
#import <objc/message.h>
#import "../local/ServicePolicy.h"
#import "../local/ShortcutPolicy.h"

static NSString *ArcModLogPath(void) {
	NSString *session = [NSBundle.mainBundle objectForInfoDictionaryKey:@"ArcModAgentSession"];
	NSString *name = session.length ? [NSString stringWithFormat:@"arcmod-agent-%@.log", session] : @"arcmod.log";
	return [NSTemporaryDirectory() stringByAppendingPathComponent:name];
}

static NSString *ArcModAgentSession(void) {
	id session = [NSBundle.mainBundle objectForInfoDictionaryKey:@"ArcModAgentSession"];
	return [session isKindOfClass:NSString.class] ? session : nil;
}

static void ArcModLog(NSString *format, ...) NS_FORMAT_FUNCTION(1, 2);
static void ArcModLog(NSString *format, ...) {
	va_list args;
	va_start(args, format);
	NSString *msg = [[NSString alloc] initWithFormat:format arguments:args];
	va_end(args);
	NSString *line = [NSString stringWithFormat:@"%@ [ArcMod pid %d] %@\n", [NSDate date], getpid(), msg];
	fputs(line.UTF8String, stderr);
	NSFileHandle *fh = [NSFileHandle fileHandleForWritingAtPath:ArcModLogPath()];
	if (!fh) {
		[[NSFileManager defaultManager] createFileAtPath:ArcModLogPath() contents:nil attributes:nil];
		fh = [NSFileHandle fileHandleForWritingAtPath:ArcModLogPath()];
	}
	[fh seekToEndOfFile];
	[fh writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
	[fh closeFile];
}

#pragma mark - Local menu validation

typedef BOOL (*ValidateMenuIMP)(id, SEL, NSMenuItem *);
static NSMutableDictionary<NSString *, NSValue *> *gOriginalMenuValidators;
typedef BOOL (*SendActionIMP)(id, SEL, SEL, id, id);
static SendActionIMP gOriginalSendAction;
static BOOL gShortcutDiagnostics;
static BOOL ArcModSendAction(id self, SEL command, SEL action, id target, id sender) {
	if (ArcModAgentSession().length && action == NSSelectorFromString(@"newLittleBrowserWindow:")) {
		// Keep explicit menu/shortcut requests on the same scriptable window kind
		// as external links. Native target resolution chooses the new-window owner.
		action = NSSelectorFromString(@"newWindow:");
		target = nil;
	}
	if (gShortcutDiagnostics) {
		id receiver = [NSApp targetForAction:action to:target from:sender];
		ArcModLog(@"shortcut action %@ -> %@", NSStringFromSelector(action), NSStringFromClass([receiver class]));
	}
	return gOriginalSendAction(self, command, action, target, sender);
}

static BOOL ArcModLocalMenuAction(NSMenuItem *item) {
	SEL action = item.action;
	if (!action) return NO;
	static SEL localActions[9];
	static dispatch_once_t once;
	dispatch_once(&once, ^{
		NSArray<NSString *> *names = @[@"newWindow:", @"newIncognitoWindow:", @"newWindowForTab:", @"newLittleBrowserWindow:", @"blankWindow:", @"showPreferences:",
			@"toggleOpenOmnibox:", @"closeCurrentItem:", @"closeWindow:"];
		for (NSUInteger i = 0; i < names.count; i++) localActions[i] = NSSelectorFromString(names[i]);
	});
	for (NSUInteger i = 0; i < sizeof(localActions) / sizeof(localActions[0]); i++) if (action == localActions[i]) return YES;
	return NO;
}

static BOOL ArcModValidateMenuItem(id self, SEL command, NSMenuItem *item) {
	for (Class cls = [self class]; cls; cls = class_getSuperclass(cls)) {
		NSString *name = NSStringFromClass(cls);
		NSValue *original = gOriginalMenuValidators[name];
		if (original) {
			BOOL nativeResult = ((ValidateMenuIMP)original.pointerValue)(self, command, item);
			// The fingerprinted native bridge now permits only local actions before
			// this controller's full state validation. Never override its result.
			if ([name isEqualToString:@"Arc.MainWindowController"]) return nativeResult;
			return nativeResult || ArcModLocalMenuAction(item);
		}
	}
	return NO;
}

static void ArcModInstallHooks(void) {
	gShortcutDiagnostics = [NSProcessInfo.processInfo.arguments containsObject:@"--arcmod-shortcut-diagnostics"];
	if (gShortcutDiagnostics || ArcModAgentSession().length) {
		Class appClass = NSClassFromString(@"Arc.BrowserApp");
		Method action = appClass ? class_getInstanceMethod(appClass, @selector(sendAction:to:from:)) : NULL;
		if (action) {
			gOriginalSendAction = (SendActionIMP)method_getImplementation(action);
			if (!class_addMethod(appClass, @selector(sendAction:to:from:), (IMP)ArcModSendAction, method_getTypeEncoding(action)))
				method_setImplementation(action, (IMP)ArcModSendAction);
		}
	}
	gOriginalMenuValidators = [NSMutableDictionary new];
	for (NSString *name in @[@"Arc.AppDelegate", @"Arc.MainWindowController", @"Arc.BrowserWindow", @"Arc.LittleBrowserWindow"]) {
		Class owner = NSClassFromString(name);
		Method validator = owner ? class_getInstanceMethod(owner, @selector(validateMenuItem:)) : NULL;
		if (!validator) continue;
		IMP original = method_getImplementation(validator);
		gOriginalMenuValidators[name] = [NSValue valueWithPointer:(const void *)original];
		// Add an override if the method is inherited, rather than mutating a superclass.
		if (!class_addMethod(owner, @selector(validateMenuItem:), (IMP)ArcModValidateMenuItem, method_getTypeEncoding(validator)))
			method_setImplementation(validator, (IMP)ArcModValidateMenuItem);
		ArcModLog(@"local browser command validation installed on %@", name);
	}
}

#pragma mark - UI proof

@interface ArcModMenuTarget : NSObject
@end

@implementation ArcModMenuTarget
- (void)showInfo:(id)sender {
	NSAlert *alert = [NSAlert new];
	alert.messageText = @"ArcMod is running inside Arc";
	alert.informativeText = [NSString stringWithFormat:@"pid %d\nNSApp class: %@\nlog: %@", getpid(),
		NSStringFromClass([NSApp class]), ArcModLogPath()];
	[alert runModal];
}
@end

static ArcModMenuTarget *gMenuTarget;

@interface ArcModBadgeView : NSView
@end
@implementation ArcModBadgeView
- (NSView *)hitTest:(NSPoint)point { return nil; }
@end

static NSView *ArcModFindSidebar(NSView *view) {
	if ([NSStringFromClass(view.class) isEqualToString:@"Arc.SidebarView"]) return view;
	for (NSView *child in view.subviews) {
		NSView *sidebar = ArcModFindSidebar(child);
		if (sidebar) return sidebar;
	}
	return nil;
}

static void ArcModInstallWindowBadge(NSWindow *window) {
	// Only main browser windows have sidebars. Cache the view weakly so a rebuilt
	// sidebar installs a new badge, without rescanning web views on every focus change.
	if (![NSStringFromClass(window.class) isEqualToString:@"Arc.BrowserWindow"]) return;
	static NSMapTable<NSWindow *, NSView *> *badges;
	static dispatch_once_t once;
	dispatch_once(&once, ^{ badges = [NSMapTable weakToWeakObjectsMapTable]; });
	if ([badges objectForKey:window].window == window) return;
		NSView *sidebar = ArcModFindSidebar(window.contentView);
		if (!sidebar) return;
		for (NSView *child in sidebar.subviews) if ([child.identifier isEqualToString:@"ArcModBadge"]) {
			[badges setObject:child forKey:window];
			return;
		}
		ArcModBadgeView *badge = [ArcModBadgeView new];
		badge.identifier = @"ArcModBadge";
		badge.accessibilityIdentifier = @"ArcModBadge";
		badge.accessibilityElement = YES;
		badge.accessibilityRole = NSAccessibilityGroupRole;
		badge.translatesAutoresizingMaskIntoConstraints = NO;
		badge.wantsLayer = YES;
		badge.layer.cornerRadius = 5;
		badge.layer.backgroundColor = [NSColor colorWithWhite:0 alpha:0.35].CGColor;
		badge.layer.borderColor = [NSColor colorWithSRGBRed:0.4 green:0.85 blue:1 alpha:0.45].CGColor;
		badge.layer.borderWidth = 1;
		NSString *session = ArcModAgentSession();
		NSString *badgeText = session.length ? [NSString stringWithFormat:@"ARC MOD · %@", session] : @"ARC MOD";
		badge.accessibilityLabel = badgeText;
		NSTextField *label = [NSTextField labelWithString:badgeText];
		label.font = [NSFont monospacedSystemFontOfSize:11 weight:NSFontWeightBold];
		label.textColor = [NSColor colorWithSRGBRed:0.65 green:0.9 blue:1 alpha:1];
		label.alignment = NSTextAlignmentCenter;
		label.lineBreakMode = NSLineBreakByTruncatingTail;
		label.toolTip = badgeText;
		label.accessibilityIdentifier = @"ArcModSessionLabel";
		label.translatesAutoresizingMaskIntoConstraints = NO;
		[badge addSubview:label];
		[sidebar addSubview:badge positioned:NSWindowAbove relativeTo:nil];
		[badges setObject:badge forKey:window];
		[NSLayoutConstraint activateConstraints:@[
			[badge.centerXAnchor constraintEqualToAnchor:sidebar.centerXAnchor],
			[badge.bottomAnchor constraintEqualToAnchor:sidebar.bottomAnchor constant:-16],
			[badge.widthAnchor constraintEqualToAnchor:label.widthAnchor constant:18], [badge.heightAnchor constraintEqualToConstant:22],
			[badge.widthAnchor constraintLessThanOrEqualToAnchor:sidebar.widthAnchor constant:-24],
			[label.centerXAnchor constraintEqualToAnchor:badge.centerXAnchor], [label.centerYAnchor constraintEqualToAnchor:badge.centerYAnchor],
		]];
		ArcModLog(@"ARC MOD sidebar badge installed");
		if (session.length) {
			// A Chromium listener alone can precede Arc's native window setup.
			// Publish a PID-bound readiness record only after the sidebar exists.
			NSURL *support = [NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
			NSURL *directory = [support URLByAppendingPathComponent:[NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleName"] isDirectory:YES];
			NSURL *ready = [directory URLByAppendingPathComponent:@"ArcModAgentReady.json"];
			NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"pid": @(getpid()), @"agent": session, @"ready": @YES} options:0 error:NULL];
			if ([data writeToURL:ready options:NSDataWritingAtomic error:NULL])
				[NSFileManager.defaultManager setAttributes:@{NSFilePosixPermissions: @0600} ofItemAtPath:ready.path error:NULL];
		}
}

static void ArcModInstallWindowBadges(void) {
	for (NSWindow *window in NSApp.windows) ArcModInstallWindowBadge(window);
}

static void ArcModEnsureLocalWindow(void) {
	BOOL hasBrowserWindow = NO;
	for (NSWindow *window in NSApp.windows) {
		NSString *name = NSStringFromClass(window.class);
		if ([name isEqualToString:@"Arc.BrowserWindow"] || [name isEqualToString:@"Arc.LittleBrowserWindow"]) hasBrowserWindow = YES;
	}
	SEL action = NSSelectorFromString(@"createNewWindow");
	if (!hasBrowserWindow && [NSApp.delegate respondsToSelector:action]) {
		ArcModLog(@"creating local browser window (no account session)");
		((void (*)(id, SEL))objc_msgSend)(NSApp.delegate, action);
	}
}

static void ArcModConsolidateLittleWindows(NSWindow *preferred) {
	// Agent bundles have their own sidebar and ordinary browser windows. Never
	// apply the human's singleton Little Arc policy to an agent's navigation.
	if (ArcModAgentSession().length) return;
	if (![NSStringFromClass(preferred.class) isEqualToString:@"Arc.LittleBrowserWindow"]) return;
	// A profile change uses Arc's native close-old/create-new path. Keep its chosen
	// profile and new window; synchronously retire any previous Little Arc so there
	// can be one, including when the native lifecycle close is still pending.
	for (NSWindow *window in NSApp.windows) {
		if (window != preferred && [NSStringFromClass(window.class) isEqualToString:@"Arc.LittleBrowserWindow"]) {
			ArcModLog(@"single Little Arc: closing previous window after native profile replacement");
			[window close];
		}
	}
	if ([NSBundle.mainBundle.bundleIdentifier hasSuffix:@".validation"]) {
		NSUInteger count = 0;
		for (NSWindow *window in NSApp.windows)
			if (window.isVisible && [NSStringFromClass(window.class) isEqualToString:@"Arc.LittleBrowserWindow"]) count++;
		ArcModLog(@"validation: %lu visible Little Arc window(s)", (unsigned long)count);
	}
}

static void ArcModInstallMenu(void) {
	NSMenu *main = NSApp.mainMenu;
	if (!main || [main itemWithTitle:@"ArcMod"]) return;
	gMenuTarget = [ArcModMenuTarget new];
	NSMenuItem *root = [[NSMenuItem alloc] initWithTitle:@"ArcMod" action:nil keyEquivalent:@""];
	NSMenu *sub = [[NSMenu alloc] initWithTitle:@"ArcMod"];
	NSMenuItem *info = [[NSMenuItem alloc] initWithTitle:@"About this mod…" action:@selector(showInfo:) keyEquivalent:@""];
	info.target = gMenuTarget;
	[sub addItem:info];
	root.submenu = sub;
	[main addItem:root];
	ArcModLog(@"menu installed");
}

static void ArcModApplyPerformanceDefaults(NSUserDefaults *defaults) {
	// These six keys have registered, typed getters in this Arc build. Preserve
	// unrelated development overrides, then apply the local performance policy.
	NSMutableDictionary<NSString *, NSString *> *overrides = [NSMutableDictionary new];
	NSString *existing = [defaults stringForKey:@"transientFeatureFlagOverrides"];
	for (NSString *pair in [existing componentsSeparatedByString:@"|"]) {
		NSArray<NSString *> *parts = [pair componentsSeparatedByString:@"="];
		if (parts.count == 2 && parts[0].length > 0) overrides[parts[0]] = parts[1];
	}
	[overrides addEntriesFromDictionary:@{
		@"lifetime-violations-reporting-enabled": @"false",
		@"record-chromium-crash-keys-in-sentry": @"false",
		@"memory-usage-event-sampling": @"0",
		@"analytics-interaction-instrumentation-client-enabled": @"false",
		@"windows-layout-cycle-tracing-enabled": @"false",
		@"sidebar-snapshot-analytics-enabled": @"false",
	}];
	NSMutableArray<NSString *> *pairs = [NSMutableArray new];
	for (NSString *key in [[overrides allKeys] sortedArrayUsingSelector:@selector(compare:)])
		[pairs addObject:[NSString stringWithFormat:@"%@=%@", key, overrides[key]]];
	[defaults setObject:[pairs componentsJoinedByString:@"|"] forKey:@"transientFeatureFlagOverrides"];
	[defaults setBool:NO forKey:@"composableArchitectureTracingInChromiumEnabled"];
}

__attribute__((constructor)) static void ArcModInit(void) {
	ArcModInstallServicePolicy();
	NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
	ArcModApplyPerformanceDefaults(defaults);
	for (NSString *key in @[@"cloudKitSyncEnabled", @"firebaseSyncEnabled", @"shouldShareUsageData", @"arcMaxAutoOptInEnabled",
		@"tidyTabsEnabled", @"instantLinksEnabled", @"askOnPageEnabled", @"hoverCardsEnabled", @"renamePinnedTabsEnabled",
		@"renameDownloadsEnabled", @"gptSiteSearchEnabled", @"calendarPreviewEnabled", @"gmailPreviewEnabled",
		@"outlookCalendarPreviewEnabled", @"outlookEmailPreviewEnabled", @"notionCalendarPreviewEnabled"])
		[defaults setBool:NO forKey:key];
	[defaults setBool:YES forKey:@"hasTurnedOffGithubLiveFolder"];
	[defaults setBool:YES forKey:@"shouldSkipUnboxingVideo"];
	// Little Arc can become key/main but is absent from Arc's AppleScript window
	// inventory. Route external links through ordinary windows for agent sessions.
	[defaults setBool:!ArcModAgentSession().length forKey:@"openExternalLinksInLittleBrowserEnabled"];
	[defaults setDouble:0 forKey:@"datadogTracesSamplingRate"];
	ArcModLog(@"loaded into %s (main image slide 0x%lx)", _dyld_get_image_name(0), (unsigned long)_dyld_get_image_vmaddr_slide(0));
	[[NSNotificationCenter defaultCenter] addObserverForName:NSApplicationDidFinishLaunchingNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification *note) {
		ArcModLog(@"didFinishLaunching, NSApp class = %@", NSStringFromClass([NSApp class]));
		ArcModInstallHooks();
		NSApp.dockTile.badgeLabel = @"MOD";
		dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{ ArcModEnsureLocalWindow(); });
		// Arc rebuilds its main menu after launch; install once it has settled, and again later as a fallback.
		dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ ArcModInstallMenu(); ArcModInstallWindowBadges(); });
		dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ ArcModInstallMenu(); ArcModInstallWindowBadges(); });
		[[NSNotificationCenter defaultCenter] addObserverForName:NSWindowDidBecomeKeyNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *event) {
			ArcModConsolidateLittleWindows(event.object);
			ArcModInstallWindowBadge(event.object);
		}];
	}];
}
