#import "ShortcutPolicy.h"
#import "ArcModShortcutPolicy.h"
#include <assert.h>

@interface ArcModTestMenuItem : NSMenuItem
@property(nonatomic, copy) NSString *testBinding;
- (id)arcKeyBindingID;
@end
@implementation ArcModTestMenuItem
- (id)arcKeyBindingID { return self.testBinding; }
@end

int main(void) {
	@autoreleasepool {
		ArcModTestMenuItem *item = [[ArcModTestMenuItem alloc] initWithTitle:@"Test" action:nil keyEquivalent:@""];
		assert(!ArcModCanValidateLocalMenuItem(nil));
		assert(!ArcModCanValidateLocalMenuItem(item));
		for (NSUInteger i = 0; i < sizeof(kArcModLocalSelectors) / sizeof(kArcModLocalSelectors[0]); i++) {
			item.action = NSSelectorFromString(kArcModLocalSelectors[i]);
			assert(ArcModCanValidateLocalMenuItem(item));
		}
		// Arc's ordinary Edit > Copy menu uses this wrapper selector, not copy:
		// or the separate Copy URL action. It must reach native responder dispatch.
		item.action = NSSelectorFromString(@"copyAction:");
		assert(ArcModCanValidateLocalMenuItem(item));
		item.testBinding = @"newNote";
		assert(!ArcModCanValidateLocalMenuItem(item));
		item.testBinding = nil;
		item.action = NSSelectorFromString(@"performWithSender:");
		assert(!ArcModCanValidateLocalMenuItem(item));
		for (NSUInteger i = 0; i < sizeof(kArcModLocalBindingIDs) / sizeof(kArcModLocalBindingIDs[0]); i++) {
			item.testBinding = kArcModLocalBindingIDs[i];
			assert(ArcModCanValidateLocalMenuItem(item));
		}
		item.testBinding = @"unregisteredCallback";
		assert(!ArcModCanValidateLocalMenuItem(item));
		// Generated BrowserWindow/LittleBrowserWindow menus retain their own
		// validation; their IDs must not become broad MainWindow callbacks.
		for (NSString *binding in @[@"item1", @"item9", @"item10", @"pane1", @"pane4", @"pane5", @"nextTab", @"previousTab", @"space1", @"space999"]) {
			item.testBinding = binding;
			assert(!ArcModCanValidateLocalMenuItem(item));
		}
		for (NSUInteger i = 0; i < sizeof(kArcModUnavailableBindingIDs) / sizeof(kArcModUnavailableBindingIDs[0]); i++) {
			item.testBinding = kArcModUnavailableBindingIDs[i];
			assert(!ArcModCanValidateLocalMenuItem(item));
			item.action = NSSelectorFromString(@"closeCurrentItem:");
			assert(!ArcModCanValidateLocalMenuItem(item));
			item.action = NSSelectorFromString(@"performWithSender:");
		}
		item.testBinding = nil;
		for (NSString *action in @[@"newNote:", @"newNoteInSplitView:", @"newEasel:", @"joinLiveMeeting:", @"peekEmail:", @"signIn:", @"unknownAction:"]) {
			item.action = NSSelectorFromString(action);
			assert(!ArcModCanValidateLocalMenuItem(item));
		}
		puts("Shortcut policy: native selectors, registered callbacks and unavailable service actions verified.");
	}
}
