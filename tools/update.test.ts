import { describe, expect, test } from "bun:test";
import { compareVersions, parseVersion } from "./update";

describe("release tags", () => {
  test("only vX.Y.Z tags are releases", () => {
    expect(parseVersion("v0.1.0")).toEqual([0, 1, 0]);
    expect(parseVersion("v0.1.0-no-login")).toBeUndefined();
    expect(parseVersion("v0.1")).toBeUndefined();
    expect(parseVersion("v0.1.0-rc1")).toBeUndefined();
  });

  test("versions compare numerically, not as text", () => {
    expect(compareVersions([0, 10, 0], [0, 9, 9])).toBeGreaterThan(0);
    expect(compareVersions([1, 0, 0], [1, 0, 0])).toBe(0);
    expect(compareVersions([0, 1, 2], [0, 2, 0])).toBeLessThan(0);
  });
});
