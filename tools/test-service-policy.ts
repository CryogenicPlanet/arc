#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { servicePolicyHeader } from "./service-policy";

const root = join(import.meta.dir, "..");
const build = join(root, "build");
mkdirSync(build, { recursive: true });
writeFileSync(join(build, "ArcModServiceHosts.h"), servicePolicyHeader);
const run = (command: readonly string[]): void => {
  const result = Bun.spawnSync([...command], { stdout: "inherit", stderr: "inherit" });
  if (!result.success) throw new Error(`service-policy check failed (exit ${result.exitCode})`);
};
const dylib = join(build, "ServicePolicyTest.dylib");
run(["clang", "-dynamiclib", "-arch", "arm64", "-fobjc-arc", "-Wall", "-Wextra", "-Werror", "-framework", "Foundation", "-I", build,
  "-install_name", dylib, "-o", dylib, join(root, "mods/local/ServicePolicy.m")]);
const test = join(build, "test-service-policy");
run(["clang", "-arch", "arm64", "-fobjc-arc", "-Wall", "-Wextra", "-Werror", "-framework", "Foundation", "-o", test,
  join(root, "mods/local/ServicePolicy.test.m"), dylib]);
run([test]);
