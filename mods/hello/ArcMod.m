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

__attribute__((constructor)) static void ArcModInit(void) {
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
		dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{ ArcModEnsureLocalWindow(); });
	}];
}
