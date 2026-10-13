#import "ShortcutPolicy.h"
#import "ArcModShortcutPolicy.h"
#import <objc/message.h>

static BOOL ArcModShortcutResult(NSMenuItem *item, BOOL result) {
	static BOOL diagnostics;
	static dispatch_once_t once;
	dispatch_once(&once, ^{ diagnostics = [NSProcessInfo.processInfo.arguments containsObject:@"--arcmod-shortcut-diagnostics"]; });
	if (diagnostics) fprintf(stderr, "[ArcMod shortcuts] %s: %s\n", item.action ? sel_getName(item.action) : "(no action)", result ? "local" : "unavailable");
	return result;
}

__attribute__((visibility("default"))) BOOL ArcModCanValidateLocalMenuItem(NSMenuItem *item) {
	if (!item.action) return ArcModShortcutResult(item, NO);
	static SEL selectors[sizeof(kArcModLocalSelectors) / sizeof(kArcModLocalSelectors[0])];
	static NSSet<NSString *> *bindingIDs, *unavailableIDs;
	static SEL bindingGetter;
	static dispatch_once_t once;
	dispatch_once(&once, ^{
		for (NSUInteger i = 0; i < sizeof(selectors) / sizeof(selectors[0]); i++) selectors[i] = NSSelectorFromString(kArcModLocalSelectors[i]);
		bindingGetter = NSSelectorFromString(@"arcKeyBindingID");
		bindingIDs = [NSSet setWithObjects:kArcModLocalBindingIDs count:sizeof(kArcModLocalBindingIDs) / sizeof(kArcModLocalBindingIDs[0])];
		unavailableIDs = [NSSet setWithObjects:kArcModUnavailableBindingIDs count:sizeof(kArcModUnavailableBindingIDs) / sizeof(kArcModUnavailableBindingIDs[0])];
	});
	id binding = [item respondsToSelector:bindingGetter] ? ((id (*)(id, SEL))objc_msgSend)(item, bindingGetter) : nil;
	if ([binding isKindOfClass:NSString.class] && [unavailableIDs containsObject:binding]) return ArcModShortcutResult(item, NO);
	for (NSUInteger i = 0; i < sizeof(selectors) / sizeof(selectors[0]); i++) if (item.action == selectors[i]) return ArcModShortcutResult(item, YES);
	// Arc's callback menu items retain their registered action ID. An arbitrary
	// callback cannot acquire local-mode permission merely by sharing its selector.
	return ArcModShortcutResult(item, item.action == NSSelectorFromString(@"performWithSender:") && [binding isKindOfClass:NSString.class] && [bindingIDs containsObject:binding]);
}
