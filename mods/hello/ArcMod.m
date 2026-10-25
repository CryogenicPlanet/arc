// ArcMod's required in-process local-mode module. Account/session data stays unchanged.
// It disables service preferences, filters native service requests, permits local browser
// commands, adds the requested sidebar marker, badges the app icon and retains one Little Arc window.

#import <AppKit/AppKit.h>
#import <CoreServices/CoreServices.h>
#import <mach-o/dyld.h>
#import <sys/xattr.h>
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

#pragma mark - Preferences (ArcMod menu)

static NSString *const ArcModHideSidebarMarkerKey = @"ArcModHideSidebarMarker";
static NSString *const ArcModHideIconBadgeKey = @"ArcModHideIconBadge";
static NSString *const ArcModAppNameKey = @"ArcModAppName";

// Agent tools find an agent build's windows by its marker, so agent builds always show it.
static BOOL ArcModSidebarMarkerShown(void) {
	return ArcModAgentSession().length || ![NSUserDefaults.standardUserDefaults boolForKey:ArcModHideSidebarMarkerKey];
}

static BOOL ArcModIconBadgeShown(void) {
	return ![NSUserDefaults.standardUserDefaults boolForKey:ArcModHideIconBadgeKey];
}

static NSString *const ArcModAutomaticUpdateCheckKey = @"ArcModCheckForUpdates";
static NSString *const ArcModLastUpdateCheckKey = @"ArcModLastUpdateCheck";

// The normal ArcMod checks for releases; agent and test builds come from the same checkout and don't.
static BOOL ArcModChecksForUpdates(void) {
	return !ArcModAgentSession().length && ![NSBundle.mainBundle.bundleIdentifier hasSuffix:@".validation"];
}

static BOOL ArcModAutomaticUpdateChecks(void) {
	id value = [NSUserDefaults.standardUserDefaults objectForKey:ArcModAutomaticUpdateCheckKey];
	return ArcModChecksForUpdates() && (!value || [value boolValue]);
}

static void ArcModInstallWindowBadges(void);
static void ArcModRemoveWindowBadges(void);
static void ArcModCheckForUpdates(BOOL userInitiated);
static void ArcModInstallUpdate(void);
static void ArcModImportFromArc(void);
static NSString *gAvailableUpdate;
static void ArcModRefreshAppIcon(BOOL rewriteBundle);

// Only the normal ArcMod can be renamed; tools/build-mod.ts re-applies the name to that build alone.
static BOOL ArcModCanRename(void) {
	return [NSBundle.mainBundle.bundleIdentifier isEqualToString:@"company.thebrowser.Browser.mod"];
}

// The name the menu bar, Dock and Finder show is the localized CFBundleName. Arc names its data folder after
// the unlocalized one, so renaming never moves ArcMod's data. tools/build-mod.ts writes the same files.
// Returns NO if a file couldn't be written.
static BOOL ArcModApplyAppName(void) {
	if (!ArcModCanRename()) return YES;
	NSString *name = [NSUserDefaults.standardUserDefaults stringForKey:ArcModAppNameKey];
	NSString *resources = NSBundle.mainBundle.resourcePath;
	NSFileManager *files = NSFileManager.defaultManager;
	NSMutableSet<NSString *> *folders = [NSMutableSet setWithObject:@"en.lproj"];
	for (NSString *item in [files contentsOfDirectoryAtPath:resources error:NULL])
		if ([item hasSuffix:@".lproj"]) [folders addObject:item];
	NSDictionary *wanted = name.length ? @{@"CFBundleName": name, @"CFBundleDisplayName": name} : nil;
	BOOL changed = NO, failed = NO;
	for (NSString *folder in folders) {
		NSString *path = [[resources stringByAppendingPathComponent:folder] stringByAppendingPathComponent:@"InfoPlist.strings"];
		NSDictionary *current = [NSDictionary dictionaryWithContentsOfFile:path];
		if (wanted && ![current isEqualToDictionary:wanted]) {
			[files createDirectoryAtPath:path.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:NULL];
			BOOL written = [wanted writeToFile:path atomically:YES];
			changed = changed || written;
			failed = failed || !written;
		} else if (!wanted && current) {
			BOOL removed = [files removeItemAtPath:path error:NULL];
			changed = changed || removed;
			failed = failed || !removed;
		}
	}
	if (changed) {
		LSRegisterURL((__bridge CFURLRef)NSBundle.mainBundle.bundleURL, true);
		ArcModLog(@"app name: %@ from the next launch", name.length ? name : @"ArcMod");
	}
	if (failed) ArcModLog(@"app name: couldn't write every InfoPlist.strings in %@", resources);
	return !failed;
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

- (void)toggleSidebarMarker:(id)sender {
	[NSUserDefaults.standardUserDefaults setBool:ArcModSidebarMarkerShown() forKey:ArcModHideSidebarMarkerKey];
	if (ArcModSidebarMarkerShown()) ArcModInstallWindowBadges();
	else ArcModRemoveWindowBadges();
}

- (void)toggleIconBadge:(id)sender {
	[NSUserDefaults.standardUserDefaults setBool:ArcModIconBadgeShown() forKey:ArcModHideIconBadgeKey];
	ArcModRefreshAppIcon(YES);
}

- (void)importFromArc:(id)sender {
	ArcModImportFromArc();
}

- (void)update:(id)sender {
	if (gAvailableUpdate) ArcModInstallUpdate();
	else ArcModCheckForUpdates(YES);
}

- (void)toggleAutomaticUpdateChecks:(id)sender {
	[NSUserDefaults.standardUserDefaults setBool:!ArcModAutomaticUpdateChecks() forKey:ArcModAutomaticUpdateCheckKey];
}

- (void)renameApp:(id)sender {
	NSAlert *alert = [NSAlert new];
	alert.messageText = @"Rename ArcMod";
	alert.informativeText = @"The menu bar, Dock and Finder show the new name from the next launch. ArcMod's data stays where it is.";
	NSTextField *field = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 0, 260, 24)];
	field.stringValue = [NSUserDefaults.standardUserDefaults stringForKey:ArcModAppNameKey] ?: @"ArcMod";
	field.placeholderString = @"ArcMod";
	alert.accessoryView = field;
	[alert addButtonWithTitle:@"Rename"];
	[alert addButtonWithTitle:@"Cancel"];
	alert.window.initialFirstResponder = field;
	if ([alert runModal] != NSAlertFirstButtonReturn) return;
	NSString *name = [field.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
	if (name.length > 40) name = [name substringWithRange:[name rangeOfComposedCharacterSequencesForRange:NSMakeRange(0, 40)]];
	if (!name.length || [name isEqualToString:@"ArcMod"]) [NSUserDefaults.standardUserDefaults removeObjectForKey:ArcModAppNameKey];
	else [NSUserDefaults.standardUserDefaults setObject:name forKey:ArcModAppNameKey];
	if (!ArcModApplyAppName()) {
		NSAlert *failure = [NSAlert new];
		failure.messageText = @"Couldn't rename ArcMod";
		failure.informativeText = [NSString stringWithFormat:@"ArcMod couldn't write its name into %@. Rebuild ArcMod to apply it.", NSBundle.mainBundle.bundlePath];
		[failure runModal];
	}
}

- (BOOL)validateMenuItem:(NSMenuItem *)item {
	if (item.action == @selector(renameApp:)) return ArcModCanRename();
	if (item.action == @selector(importFromArc:)) return !ArcModAgentSession().length;
	if (item.action == @selector(update:)) {
		item.title = gAvailableUpdate ? [NSString stringWithFormat:@"Update to %@…", gAvailableUpdate] : @"Check for Updates…";
		return ArcModChecksForUpdates();
	}
	if (item.action == @selector(toggleAutomaticUpdateChecks:)) {
		item.state = ArcModAutomaticUpdateChecks() ? NSControlStateValueOn : NSControlStateValueOff;
		return ArcModChecksForUpdates();
	}
	if (item.action == @selector(toggleSidebarMarker:)) {
		item.state = ArcModSidebarMarkerShown() ? NSControlStateValueOn : NSControlStateValueOff;
		return !ArcModAgentSession().length;
	}
	if (item.action == @selector(toggleIconBadge:)) item.state = ArcModIconBadgeShown() ? NSControlStateValueOn : NSControlStateValueOff;
	return YES;
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
	if (![NSStringFromClass(window.class) isEqualToString:@"Arc.BrowserWindow"] || !ArcModSidebarMarkerShown()) return;
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

static void ArcModRemoveWindowBadges(void) {
	for (NSWindow *window in NSApp.windows)
		for (NSView *child in [ArcModFindSidebar(window.contentView).subviews copy])
			if ([child.identifier isEqualToString:@"ArcModBadge"]) [child removeFromSuperview];
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
	NSMenuItem *import = [[NSMenuItem alloc] initWithTitle:@"Import from Arc…" action:@selector(importFromArc:) keyEquivalent:@""];
	import.target = gMenuTarget;
	[sub addItem:import];
	[sub addItem:NSMenuItem.separatorItem];
	NSMenuItem *marker = [[NSMenuItem alloc] initWithTitle:@"Show ARC MOD in Sidebar" action:@selector(toggleSidebarMarker:) keyEquivalent:@""];
	marker.target = gMenuTarget;
	[sub addItem:marker];
	NSMenuItem *badge = [[NSMenuItem alloc] initWithTitle:@"Show MOD Badge on App Icon" action:@selector(toggleIconBadge:) keyEquivalent:@""];
	badge.target = gMenuTarget;
	[sub addItem:badge];
	NSMenuItem *rename = [[NSMenuItem alloc] initWithTitle:@"Rename App…" action:@selector(renameApp:) keyEquivalent:@""];
	rename.target = gMenuTarget;
	[sub addItem:rename];
	[sub addItem:NSMenuItem.separatorItem];
	NSMenuItem *update = [[NSMenuItem alloc] initWithTitle:@"Check for Updates…" action:@selector(update:) keyEquivalent:@""];
	update.target = gMenuTarget;
	[sub addItem:update];
	NSMenuItem *automatic = [[NSMenuItem alloc] initWithTitle:@"Check for Updates Automatically" action:@selector(toggleAutomaticUpdateChecks:) keyEquivalent:@""];
	automatic.target = gMenuTarget;
	[sub addItem:automatic];
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

#pragma mark - App icon

// Arc's Settings → Icon applies a choice three ways: the Dock tile's content view, a distributed notification
// to its Dock tile plug-in, and a custom Finder icon on the bundle. ArcMod badges the icon it shows in the
// first and last, and drops the notification: the plug-in matches it by name only, so the real Arc's Dock
// tile would follow ArcMod's choice. The build removes ArcMod's own plug-in.
static NSString *const ArcModDockTilePlugInNotification = @"company.thebrowser.arc.toDockTilePlugIn";
static const void *ArcModIconSourceKey = &ArcModIconSourceKey;

// A drawn copy of an icon, with or without the MOD badge. NSWorkspace can't write an asset catalog image as
// a Finder icon, so the plain icon is redrawn too. A copy remembers its source, so the badge can come off.
static NSImage *ArcModRenderedIcon(NSImage *icon, BOOL badge) {
	NSImage *source = icon ? objc_getAssociatedObject(icon, ArcModIconSourceKey) ?: icon : nil;
	if (!source) return nil;
	NSImage *rendered = [NSImage imageWithSize:source.size flipped:NO drawingHandler:^BOOL(NSRect rect) {
		[source drawInRect:rect];
		if (!badge) return YES;
		CGFloat side = MIN(rect.size.width, rect.size.height);
		NSRect pill = NSMakeRect(NSMinX(rect) + side * 0.46, NSMinY(rect) + side * 0.09, side * 0.46, side * 0.2);
		NSBezierPath *path = [NSBezierPath bezierPathWithRoundedRect:pill xRadius:pill.size.height / 2 yRadius:pill.size.height / 2];
		[[NSColor colorWithWhite:0.08 alpha:0.92] setFill];
		[path fill];
		path.lineWidth = MAX(1, side * 0.012);
		[[NSColor colorWithSRGBRed:0.4 green:0.85 blue:1 alpha:0.9] setStroke];
		[path stroke];
		NSAttributedString *text = [[NSAttributedString alloc] initWithString:@"MOD" attributes:@{
			NSFontAttributeName: [NSFont systemFontOfSize:side * 0.12 weight:NSFontWeightHeavy],
			NSForegroundColorAttributeName: NSColor.whiteColor,
			NSKernAttributeName: @(side * 0.008),
		}];
		NSSize size = text.size;
		[text drawAtPoint:NSMakePoint(NSMidX(pill) - size.width / 2, NSMidY(pill) - size.height / 2)];
		return YES;
	}];
	objc_setAssociatedObject(rendered, ArcModIconSourceKey, source, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
	return rendered;
}

static NSImage *ArcModDisplayedIcon(NSImage *icon) {
	return ArcModRenderedIcon(icon, ArcModIconBadgeShown());
}

// The stored choice is "arc.<icon>" in standard defaults; its art is AppIcon<Icon> in Arc's base assets.
static NSImage *ArcModStoredAppIcon(void) {
	NSString *stored = [NSUserDefaults.standardUserDefaults stringForKey:@"currentAppIconName"];
	NSString *raw = [stored hasPrefix:@"arc."] && stored.length > 4 ? [stored substringFromIndex:4] : @"original";
	NSString *name = [NSString stringWithFormat:@"AppIcon%@%@", [raw substringToIndex:1].uppercaseString, [raw substringFromIndex:1]];
	NSBundle *assets = [NSBundle bundleWithPath:[NSBundle.mainBundle pathForResource:@"ARCClients_BaseAssets" ofType:@"bundle"]];
	return [assets imageForResource:name] ?: [assets imageForResource:@"AppIconOriginal"];
}

static BOOL ArcModIsMainBundlePath(NSString *path) {
	return [path.stringByStandardizingPath isEqualToString:NSBundle.mainBundle.bundlePath.stringByStandardizingPath];
}

typedef BOOL (*SetIconIMP)(id, SEL, NSImage *, NSString *, NSWorkspaceIconCreationOptions);
static SetIconIMP gOriginalSetIcon;
static BOOL ArcModSetIcon(id self, SEL command, NSImage *image, NSString *path, NSWorkspaceIconCreationOptions options) {
	if (ArcModIsMainBundlePath(path)) {
		image = ArcModDisplayedIcon(image ?: ArcModStoredAppIcon());
		ArcModLog(@"app icon: bundle icon %@, badge %@", [NSUserDefaults.standardUserDefaults stringForKey:@"currentAppIconName"] ?: @"default",
			ArcModIconBadgeShown() ? @"on" : @"off");
	}
	return gOriginalSetIcon(self, command, image, path, options);
}

typedef void (*SetContentViewIMP)(id, SEL, NSView *);
static SetContentViewIMP gOriginalSetDockContentView;
static void ArcModSetDockContentView(id self, SEL command, NSView *view) {
	if (self == NSApp.dockTile && [view isKindOfClass:NSImageView.class]) {
		NSImageView *imageView = (NSImageView *)view;
		imageView.image = ArcModDisplayedIcon(imageView.image);
	}
	gOriginalSetDockContentView(self, command, view);
}

typedef void (*PostDistributedIMP)(id, SEL, NSNotificationName, NSString *, NSDictionary *, NSDistributedNotificationOptions);
static PostDistributedIMP gOriginalPostDistributed;
static void ArcModPostDistributed(id self, SEL command, NSNotificationName name, NSString *object, NSDictionary *userInfo, NSDistributedNotificationOptions options) {
	if ([name isEqualToString:ArcModDockTilePlugInNotification]) {
		ArcModLog(@"app icon: kept %@ local", name);
		return;
	}
	gOriginalPostDistributed(self, command, name, object, userInfo, options);
}

// Arc also listens for its plug-in's replies by name, which the real Arc's plug-in sends too.
static NSString *const ArcModDockTilePlugInReplyNotification = @"company.thebrowser.arc.fromDockTilePlugIn";
typedef id (*AddObserverBlockIMP)(id, SEL, NSNotificationName, id, NSOperationQueue *, void (^)(NSNotification *));
static AddObserverBlockIMP gOriginalAddDistributedObserver;
static id ArcModAddDistributedObserver(id self, SEL command, NSNotificationName name, id object, NSOperationQueue *queue, void (^block)(NSNotification *)) {
	if ([name isEqualToString:ArcModDockTilePlugInReplyNotification]) {
		ArcModLog(@"app icon: not listening for %@", name);
		return [NSObject new];
	}
	return gOriginalAddDistributedObserver(self, command, name, object, queue, block);
}

typedef void (*PostDistributedImmediatelyIMP)(id, SEL, NSNotificationName, NSString *, NSDictionary *, BOOL);
static PostDistributedImmediatelyIMP gOriginalPostDistributedImmediately;
static void ArcModPostDistributedImmediately(id self, SEL command, NSNotificationName name, NSString *object, NSDictionary *userInfo, BOOL deliver) {
	if ([name isEqualToString:ArcModDockTilePlugInNotification]) {
		ArcModLog(@"app icon: kept %@ local", name);
		return;
	}
	gOriginalPostDistributedImmediately(self, command, name, object, userInfo, deliver);
}

static IMP ArcModReplaceMethod(Class owner, SEL selector, IMP replacement) {
	Method method = class_getInstanceMethod(owner, selector);
	if (!method) {
		ArcModLog(@"app icon: %@ has no %@", NSStringFromClass(owner), NSStringFromSelector(selector));
		return NULL;
	}
	if (class_addMethod(owner, selector, replacement, method_getTypeEncoding(method))) return method_getImplementation(method);
	return method_setImplementation(method, replacement);
}

static void ArcModInstallAppIconHooks(void) {
	gOriginalSetIcon = (SetIconIMP)ArcModReplaceMethod(NSWorkspace.class, @selector(setIcon:forFile:options:), (IMP)ArcModSetIcon);
	gOriginalSetDockContentView = (SetContentViewIMP)ArcModReplaceMethod(NSDockTile.class, @selector(setContentView:), (IMP)ArcModSetDockContentView);
	gOriginalPostDistributed = (PostDistributedIMP)ArcModReplaceMethod(NSDistributedNotificationCenter.class,
		@selector(postNotificationName:object:userInfo:options:), (IMP)ArcModPostDistributed);
	gOriginalPostDistributedImmediately = (PostDistributedImmediatelyIMP)ArcModReplaceMethod(NSDistributedNotificationCenter.class,
		@selector(postNotificationName:object:userInfo:deliverImmediately:), (IMP)ArcModPostDistributedImmediately);
	gOriginalAddDistributedObserver = (AddObserverBlockIMP)ArcModReplaceMethod(NSDistributedNotificationCenter.class,
		@selector(addObserverForName:object:queue:usingBlock:), (IMP)ArcModAddDistributedObserver);
}

// Arc writes the chosen icon into the bundle only when the choice changes, and a rebuild replaces the bundle.
// Show the stored choice (Original by default) in the Dock, and write it to the bundle when it has none yet
// or the badge setting changed.
static void ArcModRefreshAppIcon(BOOL rewriteBundle) {
	NSImage *icon = ArcModDisplayedIcon(ArcModStoredAppIcon());
	if (!icon) return;
	NSApp.applicationIconImage = icon;
	if ([NSApp.dockTile.contentView isKindOfClass:NSImageView.class]) {
		((NSImageView *)NSApp.dockTile.contentView).image = icon;
		[NSApp.dockTile display];
	}
	NSString *bundle = NSBundle.mainBundle.bundlePath;
	if (rewriteBundle || ![NSFileManager.defaultManager fileExistsAtPath:[bundle stringByAppendingPathComponent:@"Icon\r"]])
		[NSWorkspace.sharedWorkspace setIcon:icon forFile:bundle options:0];
}

#pragma mark - Updates

// Releases are GitHub tags vX.Y.Z (master; this dylib only ships on master). ArcModVersion is the build's
// `git describe`, such as v0.1.0, v0.1.0-3-g1a2b3c4 or v0.1.0-dirty; an untagged build counts as 0.0.0.
static NSURL *gAvailableUpdateURL;

static NSArray<NSNumber *> *ArcModReleaseVersion(NSString *version, BOOL exact) {
	NSString *pattern = exact ? @"^v(\\d+)\\.(\\d+)\\.(\\d+)$" : @"^v(\\d+)\\.(\\d+)\\.(\\d+)(?:-\\d+-g[0-9a-f]+)?(?:-dirty)?$";
	NSRegularExpression *expression = [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:NULL];
	NSTextCheckingResult *match = [version isKindOfClass:NSString.class] ? [expression firstMatchInString:version options:0 range:NSMakeRange(0, version.length)] : nil;
	if (!match) return exact ? nil : @[@0, @0, @0];
	return @[@([version substringWithRange:[match rangeAtIndex:1]].integerValue), @([version substringWithRange:[match rangeAtIndex:2]].integerValue),
		@([version substringWithRange:[match rangeAtIndex:3]].integerValue)];
}

static NSComparisonResult ArcModCompareVersions(NSArray<NSNumber *> *a, NSArray<NSNumber *> *b) {
	for (NSUInteger i = 0; i < 3; i++) {
		NSComparisonResult order = [a[i] compare:b[i]];
		if (order != NSOrderedSame) return order;
	}
	return NSOrderedSame;
}

static void ArcModAlert(NSString *message, NSString *information) {
	NSAlert *alert = [NSAlert new];
	alert.messageText = message;
	alert.informativeText = information;
	[alert runModal];
}

static void ArcModCheckForUpdates(BOOL userInitiated) {
	if (!ArcModChecksForUpdates()) return;
	NSString *installed = [NSBundle.mainBundle objectForInfoDictionaryKey:@"ArcModVersion"];
	NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:@"https://api.github.com/repos/CryogenicPlanet/arc/releases?per_page=50"]];
	[request setValue:@"application/vnd.github+json" forHTTPHeaderField:@"Accept"];
	[[NSURLSession.sharedSession dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
		id releases = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL] : nil;
		BOOL ok = !error && [(NSHTTPURLResponse *)response statusCode] == 200 && [releases isKindOfClass:NSArray.class];
		NSString *best;
		NSURL *bestURL;
		NSArray<NSNumber *> *bestVersion;
		for (NSDictionary *release in ok ? releases : @[]) {
			if (![release isKindOfClass:NSDictionary.class] || [release[@"draft"] boolValue] || [release[@"prerelease"] boolValue]) continue;
			NSArray<NSNumber *> *version = ArcModReleaseVersion(release[@"tag_name"], YES);
			if (!version || (bestVersion && ArcModCompareVersions(version, bestVersion) != NSOrderedDescending)) continue;
			best = release[@"tag_name"];
			bestVersion = version;
			bestURL = [release[@"html_url"] isKindOfClass:NSString.class] ? [NSURL URLWithString:release[@"html_url"]] : nil;
		}
		dispatch_async(dispatch_get_main_queue(), ^{
			if (ok) [NSUserDefaults.standardUserDefaults setObject:NSDate.date forKey:ArcModLastUpdateCheckKey];
			BOOL newer = bestVersion && ArcModCompareVersions(bestVersion, ArcModReleaseVersion(installed, NO)) == NSOrderedDescending;
			gAvailableUpdate = newer ? best : nil;
			gAvailableUpdateURL = newer ? bestURL : nil;
			ArcModLog(@"update check: %@", !ok ? error.localizedDescription ?: @"failed" : newer ? [NSString stringWithFormat:@"%@ available", best] : @"up to date");
			if (!userInitiated) return;
			if (!ok) ArcModAlert(@"Couldn't check for updates", error.localizedDescription ?: @"GitHub didn't return the release list.");
			else if (newer) ArcModInstallUpdate();
			else ArcModAlert(@"ArcMod is up to date", [NSString stringWithFormat:@"You have %@.", installed ?: @"an unreleased build"]);
		});
	}] resume];
}

static NSString *ArcModShellQuoted(NSString *value) {
	return [NSString stringWithFormat:@"'%@'", [value stringByReplacingOccurrencesOfString:@"'" withString:@"'\\''"]];
}

// The source checkout this build came from, if it's still there.
static NSString *ArcModRepository(void) {
	NSString *repository = [NSBundle.mainBundle objectForInfoDictionaryKey:@"ArcModRepository"];
	BOOL found = [repository isKindOfClass:NSString.class] &&
		[NSFileManager.defaultManager fileExistsAtPath:[repository stringByAppendingPathComponent:@"tools/build-mod.ts"]];
	if (!found) ArcModAlert(@"Couldn't find ArcMod's source", @"Run the command from the folder you built ArcMod from.");
	return found ? repository : nil;
}

// Runs `command` in the source checkout in a new Terminal window. ArcMod keeps running: the command does its
// checks and work first, then asks ArcMod to quit when it needs to, and reopens it at the end.
static void ArcModRunInTerminal(NSString *repository, NSString *command, NSString *name) {
	NSString *script = [NSTemporaryDirectory() stringByAppendingPathComponent:[name stringByAppendingPathExtension:@"command"]];
	NSString *body = [NSString stringWithFormat:@"#!/bin/zsh -l\ncd %@ || exit 1\n%@\n", ArcModShellQuoted(repository), command];
	NSError *error;
	BOOL written = [body writeToFile:script atomically:YES encoding:NSUTF8StringEncoding error:&error] &&
		[NSFileManager.defaultManager setAttributes:@{NSFilePosixPermissions: @0700} ofItemAtPath:script error:&error];
	// Arc's Info.plist turns on file quarantine, which would make Gatekeeper refuse a script ArcMod wrote.
	if (written) removexattr(script.fileSystemRepresentation, "com.apple.quarantine", 0);
	if (!written || ![NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:script]])
		ArcModAlert(@"Couldn't open Terminal", error.localizedDescription ?: @"Terminal didn't open the script.");
}

// The update runs from the source checkout: tools/update.ts waits for ArcMod to quit, moves the source to the
// release, rebuilds and reopens ArcMod.
static void ArcModInstallUpdate(void) {
	NSString *repository = ArcModRepository();
	if (!repository) return;
	NSAlert *alert = [NSAlert new];
	alert.messageText = [NSString stringWithFormat:@"Update ArcMod to %@?", gAvailableUpdate];
	alert.informativeText = [NSString stringWithFormat:@"Terminal updates the source in %@ and builds the new ArcMod while you keep browsing. "
		@"Then it asks ArcMod to quit and reopens it. It takes about a minute.", repository];
	[alert addButtonWithTitle:@"Update"];
	[alert addButtonWithTitle:@"Release Notes"];
	[alert addButtonWithTitle:@"Later"];
	NSModalResponse choice = [alert runModal];
	if (choice == NSAlertSecondButtonReturn && gAvailableUpdateURL) [NSWorkspace.sharedWorkspace openURL:gAvailableUpdateURL];
	if (choice != NSAlertFirstButtonReturn) return;
	ArcModRunInTerminal(repository, @"bun tools/update.ts --quit-arcmod --relaunch", @"arcmod-update");
}

// tools/import-arc-data.ts replaces ArcMod's profile, so ArcMod has to be closed while it runs, and so does Arc.
static void ArcModImportFromArc(void) {
	NSString *repository = ArcModRepository();
	if (!repository) return;
	NSAlert *alert = [NSAlert new];
	alert.messageText = @"Import your Arc data?";
	alert.informativeText = @"Terminal copies cookies, site storage, extensions, history and permissions from Arc into ArcMod, so your "
		@"sites stay signed in. Spaces and Arc account data aren't copied. Your current ArcMod profile is kept as a backup.\n\n"
		@"Terminal asks ArcMod to quit, then waits for you to quit Arc. When macOS asks to read \"Arc Safe Storage\", choose Allow. "
		@"ArcMod reopens when it's done.";
	[alert addButtonWithTitle:@"Import"];
	[alert addButtonWithTitle:@"Cancel"];
	if ([alert runModal] != NSAlertFirstButtonReturn) return;
	BOOL validation = [NSBundle.mainBundle.bundleIdentifier hasSuffix:@".validation"];
	NSString *command = validation ? @"bun tools/import-arc-data.ts --validation --quit-arcmod --relaunch" : @"bun tools/import-arc-data.ts --quit-arcmod --relaunch";
	ArcModRunInTerminal(repository, command, @"arcmod-import");
}

__attribute__((constructor)) static void ArcModInit(void) {
	ArcModInstallServicePolicy();
	ArcModInstallAppIconHooks();
	NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
	ArcModApplyPerformanceDefaults(defaults);
	for (NSString *key in @[@"cloudKitSyncEnabled", @"firebaseSyncEnabled", @"shouldShareUsageData", @"arcMaxAutoOptInEnabled",
		@"tidyTabsEnabled", @"instantLinksEnabled", @"askOnPageEnabled", @"hoverCardsEnabled", @"renamePinnedTabsEnabled",
		@"renameDownloadsEnabled", @"gptSiteSearchEnabled", @"calendarPreviewEnabled", @"gmailPreviewEnabled",
		@"outlookCalendarPreviewEnabled", @"outlookEmailPreviewEnabled", @"notionCalendarPreviewEnabled"])
		[defaults setBool:NO forKey:key];
	[defaults setBool:YES forKey:@"hasTurnedOffGithubLiveFolder"];
	// Arc reopens your windows only when its "restore windows from previous session" setting is on. On first
	// launch Arc copies that from macOS's "Close windows when quitting an application", which is on by default,
	// so it starts off. Turn it on once (Arc's Settings can turn it off), with the per-app AppKit preference Arc
	// sets alongside it. Agent builds keep Arc's default; their tests expect fresh windows.
	if (!ArcModAgentSession().length && ![defaults boolForKey:@"ArcModRestoreWindowsDefaulted"]) {
		[defaults setBool:YES forKey:@"arc_quitAlwaysKeepsWindows"];
		[defaults setBool:YES forKey:@"NSQuitAlwaysKeepsWindows"];
		[defaults setBool:YES forKey:@"ArcModRestoreWindowsDefaulted"];
	}
	[defaults setBool:YES forKey:@"shouldSkipUnboxingVideo"];
	// Little Arc can become key/main but is absent from Arc's AppleScript window
	// inventory. Route external links through ordinary windows for agent sessions.
	[defaults setBool:!ArcModAgentSession().length forKey:@"openExternalLinksInLittleBrowserEnabled"];
	[defaults setDouble:0 forKey:@"datadogTracesSamplingRate"];
	ArcModLog(@"loaded into %s (main image slide 0x%lx)", _dyld_get_image_name(0), (unsigned long)_dyld_get_image_vmaddr_slide(0));
	[[NSNotificationCenter defaultCenter] addObserverForName:NSApplicationDidFinishLaunchingNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification *note) {
		ArcModLog(@"didFinishLaunching, NSApp class = %@", NSStringFromClass([NSApp class]));
		ArcModInstallHooks();
		ArcModRefreshAppIcon(NO);
		ArcModApplyAppName();
		// At most one release check a day: 15 s after launch, then whenever the hourly timer finds the last one stale.
		void (^checkIfDue)(void) = ^{
			NSDate *checked = [NSUserDefaults.standardUserDefaults objectForKey:ArcModLastUpdateCheckKey];
			if (ArcModAutomaticUpdateChecks() && (![checked isKindOfClass:NSDate.class] || -checked.timeIntervalSinceNow > 20 * 60 * 60))
				ArcModCheckForUpdates(NO);
		};
		dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC), dispatch_get_main_queue(), checkIfDue);
		[NSTimer scheduledTimerWithTimeInterval:60 * 60 repeats:YES block:^(__unused NSTimer *timer) { checkIfDue(); }];
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
