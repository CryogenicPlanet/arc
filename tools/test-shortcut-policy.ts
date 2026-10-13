import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shortcutPolicyHeader } from "./shortcut-policy";
const root = join(import.meta.dir, "..");
const out = join(root, "build/shortcut-policy-test");
mkdirSync(out, {recursive:true});
writeFileSync(join(out, "ArcModShortcutPolicy.h"), shortcutPolicyHeader);
const exe = join(out, "test");
for (const args of [
  ["clang", "-arch", "arm64", "-fobjc-arc", "-Wall", "-Wextra", "-Werror", "-framework", "AppKit", "-I", out, "-o", exe, join(root,"mods/local/ShortcutPolicy.m"), join(root,"mods/local/ShortcutPolicy.test.m")],
  [exe],
]) {
  const result = Bun.spawnSync(args, {stdout:"inherit",stderr:"inherit"});
  if (!result.success) throw new Error("shortcut policy native test failed");
}
