#import "ServicePolicy.h"
#include <netdb.h>

int main(void) {
	@autoreleasepool {
		NSArray<NSString *> *blocked = @[@"arc.net", @"api.arc.net", @"FIRESTORE.GOOGLEAPIS.COM.", @"aiproxy.diabrowser.engineering"];
		NSArray<NSString *> *allowed = @[@"example.com", @"notarc.net", @"arc.net.example.com", @"127.0.0.1", @"localhost"];
		for (NSString *host in blocked) if (!ArcModShouldBlockHost(host.UTF8String)) return 1;
		for (NSString *host in allowed) if (ArcModShouldBlockHost(host.UTF8String)) return 2;
		struct addrinfo *result = NULL;
		if (getaddrinfo("firestore.googleapis.com", "443", NULL, &result) != EAI_NONAME || result != NULL) return 3;
		struct addrinfo hints = { .ai_flags = AI_NUMERICHOST, .ai_family = AF_INET };
		if (getaddrinfo("127.0.0.1", "80", &hints, &result) != 0) return 4;
		freeaddrinfo(result);
		ArcModInstallServicePolicy();
		dispatch_semaphore_t done = dispatch_semaphore_create(0);
		__block BOOL filtered = NO;
		NSURLSession *session = [NSURLSession sessionWithConfiguration:NSURLSessionConfiguration.ephemeralSessionConfiguration];
		NSURLSessionDataTask *task = [session dataTaskWithURL:[NSURL URLWithString:@"https://identitytoolkit.googleapis.com/"]
			completionHandler:^(__unused NSData *data, __unused NSURLResponse *response, NSError *error) {
				filtered = [error.domain isEqualToString:NSURLErrorDomain] && error.code == NSURLErrorNotConnectedToInternet;
				dispatch_semaphore_signal(done);
			}];
		[task resume];
		if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) != 0 || !filtered) return 5;
		[session invalidateAndCancel];
		puts("Service policy: boundary matching, process DNS denial, loopback access and NSURLSession filtering passed.");
	}
	return 0;
}
