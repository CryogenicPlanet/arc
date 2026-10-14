import { describe, expect, test } from "bun:test";
import policy from "../resources/local-shortcut-policy.json";
import snapshot from "../resources/shortcut-menu-inventory.json";
import { auditShortcutCoverage } from "./shortcut-coverage";

describe("complete menu shortcut coverage", () => {
  test("covers every actionable shipped menu item including unbound wrappers", () => {
    const rows = auditShortcutCoverage(snapshot.entries);
    expect(rows).toHaveLength(162);
    expect(rows.filter((row) => row.bindingId)).toHaveLength(89);
    expect(rows.filter((row) => row.route === "unavailable-feature")).toHaveLength(5);
    expect(rows.find((row) => row.selector === "copyAction:")?.route).toBe("local-policy");
    expect(rows.find((row) => row.selector === "undo:")?.route).toBe("nativeResponder");
  });
  test("detects removal of ordinary Copy even though it has no registered binding ID", () => {
    expect(() => auditShortcutCoverage(snapshot.entries, { ...policy, selectors: policy.selectors.filter((item) => item !== "copyAction:") })).toThrow("copyAction:");
  });
  test("detects an omitted local menu wrapper or dynamic Space selector", () => {
    for (const selector of ["openTaskManager:", "newProfile:", "renameFocusedSpace:", "focusSpace:"]) {
      expect(() => auditShortcutCoverage(snapshot.entries, { ...policy, selectors: policy.selectors.filter((item) => item !== selector) })).toThrow(selector);
    }
  });
  test("requires registered callback permissions and retains service denial", () => {
    expect(() => auditShortcutCoverage(snapshot.entries, { ...policy, bindingIDs: policy.bindingIDs.filter((item) => item !== "addressBar") })).toThrow("addressBar");
    expect(() => auditShortcutCoverage(snapshot.entries, { ...policy, bindingIDs: [...policy.bindingIDs, "newNote"] })).toThrow("unavailable binding admitted");
  });
  test("unknown future menu actions fail instead of being broadly admitted", () => {
    expect(() => auditShortcutCoverage([...snapshot.entries, { ...snapshot.entries[0]!, selector: "unknownNewAction:", title: "Future action", bindingId: null }])).toThrow("unknownNewAction:");
  });
  test("service exemptions cannot hide accidental local admission", () => {
    expect(() => auditShortcutCoverage(snapshot.entries, { ...policy, selectors: [...policy.selectors, "openBoostGallery:"] })).toThrow("service action admitted");
    expect(auditShortcutCoverage(snapshot.entries).find((row) => row.selector === "gptMessage:")?.route).toBe("local-policy");
  });
});
