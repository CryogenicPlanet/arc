import policy from "../resources/local-shortcut-policy.json";
export const localShortcutPolicy = policy;
for (const [name, entries] of Object.entries(policy)) {
  if (!Array.isArray(entries)) continue;
  if (new Set(entries).size !== entries.length || entries.some((entry) => !/^[A-Za-z][A-Za-z0-9_:]*$/.test(entry))) throw new Error(`invalid shortcut policy ${name}`);
}
if (policy.unavailableBindingIDs.some((id) => policy.bindingIDs.includes(id))) throw new Error("unavailable shortcut included in local policy");
const array = (name: string, values: readonly string[]) => `static NSString *const ${name}[] = {\n${values.map((value) => `  @"${value}",`).join("\n")}\n};\n`;
export const shortcutPolicyHeader = "// Generated from resources/local-shortcut-policy.json.\n" + array("kArcModLocalSelectors", policy.selectors) + array("kArcModLocalBindingIDs", policy.bindingIDs) + array("kArcModUnavailableBindingIDs", policy.unavailableBindingIDs);
