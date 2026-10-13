#import "ServicePolicy.h"
#import "ArcModServiceHosts.h"
#import <objc/runtime.h>
#include <netdb.h>
#include <string.h>
#include <strings.h>

bool ArcModShouldBlockHost(const char *host) {
	if (!host) return false;
	size_t length = strlen(host);
	while (length > 0 && host[length - 1] == '.') length--;
	for (size_t i = 0; i < sizeof(kArcModBlockedHosts) / sizeof(kArcModBlockedHosts[0]); i++) {
		const char *blocked = kArcModBlockedHosts[i];
		size_t blockedLength = strlen(blocked);
		if (length >= blockedLength && strncasecmp(host + length - blockedLength, blocked, blockedLength) == 0 &&
			(length == blockedLength || host[length - blockedLength - 1] == '.')) return true;
	}
	return false;
}

static int ArcModGetAddrInfo(const char *host, const char *service, const struct addrinfo *hints, struct addrinfo **result) {
	if (ArcModShouldBlockHost(host)) {
		if (result) *result = NULL;
		return EAI_NONAME;
	}
	return getaddrinfo(host, service, hints, result);
}

// Applies to the mod's process, never the original Arc or macOS's global resolver.
__attribute__((used)) static const struct { const void *replacement; const void *original; }
	kArcModDNSInterpose __attribute__((section("__DATA,__interpose"))) = {
		(const void *)ArcModGetAddrInfo, (const void *)getaddrinfo,
	};

@interface ArcModBlockedServiceProtocol : NSURLProtocol
@end

@implementation ArcModBlockedServiceProtocol
+ (BOOL)canInitWithRequest:(NSURLRequest *)request {
	return ArcModShouldBlockHost(request.URL.host.UTF8String);
}
+ (BOOL)canInitWithTask:(NSURLSessionTask *)task {
	return [self canInitWithRequest:task.currentRequest];
}
+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request { return request; }
- (void)startLoading {
	// Log only the hostname. URLs may contain tokens or personal data.
	fprintf(stderr, "[ArcMod] blocked service: %s\n", self.request.URL.host.UTF8String);
	NSError *error = [NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorNotConnectedToInternet
		userInfo:@{NSLocalizedDescriptionKey: @"This service is disabled in ArcMod's local mode."}];
	[self.client URLProtocol:self didFailWithError:error];
}
- (void)stopLoading {}
@end

typedef id (*SessionFactoryIMP)(id, SEL, NSURLSessionConfiguration *, id, NSOperationQueue *);
static SessionFactoryIMP gOriginalSessionFactory;

static id ArcModSessionFactory(id self, SEL command, NSURLSessionConfiguration *configuration, id delegate, NSOperationQueue *queue) {
	NSURLSessionConfiguration *localConfiguration = [configuration copy];
	NSMutableArray<Class> *protocols = [localConfiguration.protocolClasses mutableCopy] ?: [NSMutableArray new];
	if (![protocols containsObject:ArcModBlockedServiceProtocol.class]) [protocols insertObject:ArcModBlockedServiceProtocol.class atIndex:0];
	localConfiguration.protocolClasses = protocols;
	return gOriginalSessionFactory(self, command, localConfiguration, delegate, queue);
}

void ArcModInstallServicePolicy(void) {
	[NSURLProtocol registerClass:ArcModBlockedServiceProtocol.class];
	Method factory = class_getClassMethod(NSURLSession.class, @selector(sessionWithConfiguration:delegate:delegateQueue:));
	if (!factory) [NSException raise:NSInternalInconsistencyException format:@"ArcMod cannot install the service request filter"];
	gOriginalSessionFactory = (SessionFactoryIMP)method_setImplementation(factory, (IMP)ArcModSessionFactory);
}
