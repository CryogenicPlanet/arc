// ArcMod's required in-process local-mode module. Account/session data stays unchanged.
// It disables service preferences, filters native service requests, permits local browser
// commands and opens a local window when none exists.

#import <AppKit/AppKit.h>
#import <mach-o/dyld.h>
#import <objc/runtime.h>
#import <objc/message.h>
#import "../local/ServicePolicy.h"
#import "../local/ShortcutPolicy.h"

static NSString *ArcModLogPath(void) {
	return [NSTemporaryDirectory() stringByAppendingPathComponent:@"arcmod.log"];
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
static SendActionIMP gDiagnosticSendAction;
static BOOL ArcModDiagnosticSendAction(id self, SEL command, SEL action, id target, id sender) {
	id receiver = [NSApp targetForAction:action to:target from:sender];
	ArcModLog(@"shortcut action %@ -> %@", NSStringFromSelector(action), NSStringFromClass([receiver class]));
	return gDiagnosticSendAction(self, command, action, target, sender);
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
	// Explicit troubleshooting only; ordinary launches retain the native action path.
	if ([NSProcessInfo.processInfo.arguments containsObject:@"--arcmod-shortcut-diagnostics"]) {
		Class appClass = NSClassFromString(@"Arc.BrowserApp");
		Method action = appClass ? class_getInstanceMethod(appClass, @selector(sendAction:to:from:)) : NULL;
		if (action) {
			gDiagnosticSendAction = (SendActionIMP)method_getImplementation(action);
			if (!class_addMethod(appClass, @selector(sendAction:to:from:), (IMP)ArcModDiagnosticSendAction, method_getTypeEncoding(action)))
				method_setImplementation(action, (IMP)ArcModDiagnosticSendAction);
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

#pragma mark - Local window

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

// Chromium switches ArcMod needs from the first moment: Arc's hosts resolve to nowhere, a mock keychain (so
// macOS never asks for a keychain key, including the real Arc's), and no sync or background networking.
// Arc's app hands Chromium its arguments through ArcBrowserApplicationConfiguration (the same initializer in
// Arc's engine and in Arc Engine), so they're added there; that lets ArcMod open like any app (Finder, Dock,
// Spotlight). tools/run-mod.sh passes the same ones, and a switch that's already there isn't added twice.
// The switch's name, with Chromium's one- or two-dash forms treated alike.
static NSString *ArcModSwitchName(NSString *argument) {
	NSString *name = [argument componentsSeparatedByString:@"="].firstObject;
	while ([name hasPrefix:@"-"]) name = [name substringFromIndex:1];
	return name;
}

// Inserted right after the program name (Chromium stops reading switches at a bare "--"). A host-resolver-rules
// switch that's already there is merged with ArcMod's rules rather than replacing them.
static NSArray<NSString *> *ArcModWithLaunchSwitches(NSArray<NSString *> *argv) {
	NSString *rules = [NSBundle.mainBundle objectForInfoDictionaryKey:@"ArcModHostResolverRules"];
	if (![rules isKindOfClass:NSString.class]) rules = @"";
	NSMutableArray<NSString *> *result = [NSMutableArray new];
	NSMutableSet<NSString *> *present = [NSMutableSet new];
	BOOL switches = YES;
	for (id argument in argv) {
		if (![argument isKindOfClass:NSString.class]) continue;
		if ([argument isEqualToString:@"--"]) switches = NO;
		if (switches && result.count && [argument hasPrefix:@"-"]) {
			NSString *name = ArcModSwitchName(argument);
			[present addObject:name];
			NSRange equals = [argument rangeOfString:@"="];
			NSString *value = equals.location == NSNotFound ? @"" : [argument substringFromIndex:NSMaxRange(equals)];
			if ([name isEqualToString:@"host-resolver-rules"] && rules.length && equals.location != NSNotFound && ![value hasPrefix:rules]) {
				[result addObject:[NSString stringWithFormat:@"--host-resolver-rules=%@, %@", rules, value]];
				continue;
			}
		}
		[result addObject:argument];
	}
	if (!result.count) [result addObject:NSProcessInfo.processInfo.arguments.firstObject ?: @"Arc"];
	NSMutableArray<NSString *> *wanted = [@[@"--use-mock-keychain", @"--no-default-browser-check", @"--disable-sync",
		@"--disable-background-networking"] mutableCopy];
	if (rules.length) [wanted addObject:[@"--host-resolver-rules=" stringByAppendingString:rules]];
	NSUInteger insertAt = 1;
	for (NSString *argument in wanted)
		if (![present containsObject:ArcModSwitchName(argument)]) [result insertObject:argument atIndex:insertAt++];
	return result;
}

// An init method: it consumes self and returns a retained object.
typedef id (*ConfigurationInitIMP)(__attribute__((ns_consumed)) id, SEL, int, NSArray *, NSString *, NSUInteger, BOOL, NSUInteger,
	BOOL, BOOL, NSString *) __attribute__((ns_returns_retained));
static ConfigurationInitIMP gOriginalConfigurationInit;
static id ArcModConfigurationInit(__attribute__((ns_consumed)) id self, SEL command, __unused int argc, NSArray *argv, NSString *profilePath,
		NSUInteger applicationID, BOOL isProduction, NSUInteger restorationPolicy, BOOL loadAllProfiles, BOOL quitRunLoop,
		NSString *suiteName) __attribute__((ns_returns_retained)) {
	NSArray<NSString *> *extended = ArcModWithLaunchSwitches(argv);
	if (![extended isEqualToArray:argv]) ArcModLog(@"launch switches: added %lu", (unsigned long)(extended.count - argv.count));
	return gOriginalConfigurationInit(self, command, (int)extended.count, extended, profilePath, applicationID, isProduction,
		restorationPolicy, loadAllProfiles, quitRunLoop, suiteName);
}

static void ArcModAddLaunchSwitches(void) {
	Class configuration = NSClassFromString(@"ArcBrowserApplicationConfiguration");
	SEL init = NSSelectorFromString(@"init:argv:profilePath:applicationID:isProduction:sessionRestorationPolicy:"
		@"shouldLoadAllProfilesAtStartup:quitRunLoopOnTermination:userDefaultsSuiteName:");
	Method method = configuration ? class_getInstanceMethod(configuration, init) : NULL;
	if (method && strcmp(method_getTypeEncoding(method), "@72@0:8i16@20@28Q36B44Q48B56B60@64") == 0) {
		gOriginalConfigurationInit = (ConfigurationInitIMP)method_setImplementation(method, (IMP)ArcModConfigurationInit);
		return;
	}
	// Fail closed: without these switches Chromium would use the real keychain (asking for "Arc Safe Storage") and
	// reach Arc's hosts. If the engine's initializer isn't the expected one, restart this process with them.
	NSArray<NSString *> *arguments = NSProcessInfo.processInfo.arguments;
	NSMutableSet<NSString *> *present = [NSMutableSet new];
	for (NSString *argument in arguments) [present addObject:ArcModSwitchName(argument)];
	NSSet<NSString *> *required = [NSSet setWithArray:@[@"use-mock-keychain", @"no-default-browser-check", @"disable-sync",
		@"disable-background-networking", @"host-resolver-rules"]];
	if ([required isSubsetOfSet:present]) return;
	NSArray<NSString *> *extended = ArcModWithLaunchSwitches(arguments);
	if (getenv("ARCMOD_RELAUNCHED_WITH_SWITCHES")) {
		fputs("ArcMod: couldn't add its launch switches; refusing to start without them\n", stderr);
		exit(1);
	}
	ArcModLog(@"launch switches: engine initializer not found; restarting with the switches");
	setenv("ARCMOD_RELAUNCHED_WITH_SWITCHES", "1", 1);
	char **argv = calloc(extended.count + 1, sizeof(char *));
	if (!argv) exit(1);
	for (NSUInteger i = 0; i < extended.count; i++) argv[i] = strdup(extended[i].UTF8String);
	execv(NSBundle.mainBundle.executablePath.fileSystemRepresentation, argv);
	exit(1);
}

// One ArcMod per bundle ID: two copies (say an installed one and a --debug build) share one data folder, and
// Finder, the Dock and Spotlight don't stop a second launch. Hand over to the running copy instead.
static void ArcModEnsureSingleInstance(void) {
	pid_t me = getpid();
	for (NSRunningApplication *other in [NSRunningApplication runningApplicationsWithBundleIdentifier:NSBundle.mainBundle.bundleIdentifier]) {
		if (other.processIdentifier == me) continue;
		// A copy that's still quitting (Chromium can take a few seconds) gets time to finish first.
		for (int i = 0; i < 50 && kill(other.processIdentifier, 0) == 0; i++) usleep(100000);
		if (kill(other.processIdentifier, 0) != 0) continue;
		ArcModLog(@"another copy is running (pid %d, %@); switching to it", other.processIdentifier, other.bundleURL.path);
		[other activateWithOptions:NSApplicationActivateAllWindows];
		exit(0);
	}
}

__attribute__((constructor)) static void ArcModInit(void) {
	ArcModEnsureSingleInstance();
	ArcModAddLaunchSwitches();
	ArcModInstallServicePolicy();
	NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
	for (NSString *key in @[@"cloudKitSyncEnabled", @"firebaseSyncEnabled", @"shouldShareUsageData", @"arcMaxAutoOptInEnabled",
		@"tidyTabsEnabled", @"instantLinksEnabled", @"askOnPageEnabled", @"hoverCardsEnabled", @"renamePinnedTabsEnabled",
		@"renameDownloadsEnabled", @"gptSiteSearchEnabled", @"calendarPreviewEnabled", @"gmailPreviewEnabled",
		@"outlookCalendarPreviewEnabled", @"outlookEmailPreviewEnabled", @"notionCalendarPreviewEnabled"])
		[defaults setBool:NO forKey:key];
	[defaults setBool:YES forKey:@"shouldSkipUnboxingVideo"];
	// Arc reopens your windows only when its "restore windows from previous session" setting is on. On first
	// launch Arc copies that from macOS's "Close windows when quitting an application", which is on by default,
	// so it starts off. Turn it on once (Arc's Settings can turn it off), with the per-app AppKit preference Arc
	// sets alongside it.
	if (![defaults boolForKey:@"ArcModRestoreWindowsDefaulted"]) {
		[defaults setBool:YES forKey:@"arc_quitAlwaysKeepsWindows"];
		[defaults setBool:YES forKey:@"NSQuitAlwaysKeepsWindows"];
		[defaults setBool:YES forKey:@"ArcModRestoreWindowsDefaulted"];
	}
	ArcModLog(@"loaded into %s (main image slide 0x%lx)", _dyld_get_image_name(0), (unsigned long)_dyld_get_image_vmaddr_slide(0));
	[[NSNotificationCenter defaultCenter] addObserverForName:NSApplicationDidFinishLaunchingNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification *note) {
		ArcModLog(@"didFinishLaunching, NSApp class = %@", NSStringFromClass([NSApp class]));
		ArcModInstallHooks();
		// With "restore windows" on, give Arc's own restore time first so a slow launch doesn't get an extra window.
		int64_t fallback = [NSUserDefaults.standardUserDefaults boolForKey:@"arc_quitAlwaysKeepsWindows"] ? 3 : 1;
		dispatch_after(dispatch_time(DISPATCH_TIME_NOW, fallback * (int64_t)NSEC_PER_SEC), dispatch_get_main_queue(), ^{ ArcModEnsureLocalWindow(); });
	}];
}
