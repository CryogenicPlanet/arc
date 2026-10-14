import { existsSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import policy from "../resources/local-shortcut-policy.json";
import routing from "../resources/shortcut-menu-routing.json";
import snapshot from "../resources/shortcut-menu-inventory.json";
import { inventoryFromArc, type MenuEntry } from "./shortcut-inventory";
import { verifyGeneratedShortcutCoverage } from "./shortcut-generated-coverage";

type Policy = { selectors: readonly string[]; bindingIDs: readonly string[]; unavailableBindingIDs: readonly string[] };
export type MenuRoute = "local-policy" | "unavailable-feature" | "nativeResponder" | "nativeSystem" | "nativeAppearance" | "nativeDiagnostics" | "serviceOrIntegration";
const routes = ["nativeResponder", "nativeSystem", "nativeAppearance", "nativeDiagnostics", "serviceOrIntegration"] as const;
const reasons: Record<MenuRoute, string> = {
  "local-policy": "Finite admission, followed by unchanged native state validation and dispatch.",
  "unavailable-feature": "Account/backend feature unavailable in the local build.",
  nativeResponder: "AppKit or Chromium text/formatting responder; availability depends on selection and editable/rich text context.",
  nativeSystem: "Native application/window/system operation; user-invoked system permission flows remain unchanged.",
  nativeAppearance: "Separate native AppDelegate appearance validation; unaffected by the local menu gate.",
  nativeDiagnostics: "Hidden native recording diagnostics; original account/recording-state gates retained, no default shortcut.",
  serviceOrIntegration: "Backend, updater, legacy content, vendor help or other-app dependency; existing guards/filtering retained.",
};

// Exemptions are explicit and disjoint. An unknown menu action is never silently
// treated as a text responder or admitted merely because it has a shortcut.
for (const key of routes) for (const selector of routing[key]) {
  if (routes.some((other) => other !== key && routing[other].includes(selector))) throw new Error(`duplicate routing classification: ${selector}`);
}

export function auditShortcutCoverage(entries: readonly MenuEntry[], value: Policy = policy) {
  const selectors = new Set(value.selectors), bindings = new Set(value.bindingIDs), unavailable = new Set(value.unavailableBindingIDs);
  for (const selector of routing.dynamicLocalSelectors) if (!selectors.has(selector)) throw new Error(`missing dynamic local selector: ${selector}`);
  return entries.map((entry) => {
    let route: MenuRoute;
    if (entry.bindingId && unavailable.has(entry.bindingId)) {
      if (bindings.has(entry.bindingId)) throw new Error(`unavailable binding admitted: ${entry.bindingId}`);
      route = "unavailable-feature";
    } else {
      const native = routes.find((key) => routing[key].includes(entry.selector));
      if (native) {
        if (native === "serviceOrIntegration" && (selectors.has(entry.selector) || (entry.bindingId !== null && bindings.has(entry.bindingId)))) {
          throw new Error(`service action admitted by local policy: ${entry.selector}`);
        }
        route = native;
      }
      else {
        if (!selectors.has(entry.selector)) throw new Error(`missing local menu selector: ${entry.title} (${entry.selector})`);
        if (entry.bindingId && !bindings.has(entry.bindingId)) throw new Error(`missing local callback binding: ${entry.bindingId}`);
        route = "local-policy";
      }
    }
    return { ...entry, route, availability: reasons[route] };
  });
}

export function verifyShippedShortcutCoverage(source = "/Applications/Arc.app") {
  const actual = inventoryFromArc(source);
  if (actual.sourceSha256 !== snapshot.sourceSha256 || !isDeepStrictEqual(actual.entries, snapshot.entries)) {
    throw new Error("Arc menu inventory drift: regenerate and review every action before building");
  }
  verifyGeneratedShortcutCoverage(source);
  return auditShortcutCoverage(actual.entries);
}

if (import.meta.main) {
  if (!existsSync(join(import.meta.dir, "../bin/Arc.arm64"))) throw new Error("bin/Arc.arm64 is required; extract it as documented in README before running checks");
  const entries = verifyShippedShortcutCoverage();
  console.log(`Shortcut coverage: ${entries.length} shipped menu actions classified; dynamic Space selection admitted.`);
}
