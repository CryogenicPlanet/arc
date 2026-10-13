import policy from "../resources/local-service-policy.json";

export const blockedServiceHosts: readonly string[] = policy.native;
export const chromiumServiceHosts: readonly string[] = policy.chromium;
if ([policy.native, policy.chromium].some((hosts) => hosts.some((host) => !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(host)) || new Set(hosts).size !== hosts.length)) {
  throw new Error("invalid or duplicate local service hostname");
}

export const hostResolverRules = policy.chromium.flatMap((host) => [`MAP ${host} ~NOTFOUND`, `MAP *.${host} ~NOTFOUND`]).join(", ");
export const servicePolicyHeader = `// Generated from resources/local-service-policy.json.\nstatic const char *const kArcModBlockedHosts[] = {\n${policy.native.map((host) => `  "${host}",`).join("\n")}\n};\n`;
