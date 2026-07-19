import { describe, expect, test } from "bun:test";
import { shouldRefreshDeliveryBranch } from "../src/domain/delivery/refresh-policy";

describe("delivery refresh policy", () => {
  test("refreshes conflicting pull requests unless refresh is disabled", () => {
    expect(shouldRefreshDeliveryBranch("auto", "DIRTY", false)).toBe(true);
    expect(shouldRefreshDeliveryBranch("always", "DIRTY", false)).toBe(true);
    expect(shouldRefreshDeliveryBranch("conflicts-only", "DIRTY", false)).toBe(true);
    expect(shouldRefreshDeliveryBranch("never", "DIRTY", true)).toBe(false);
  });

  test("leaves mergeable behind pull requests alone by default", () => {
    expect(shouldRefreshDeliveryBranch("auto", "BEHIND", false)).toBe(false);
    expect(shouldRefreshDeliveryBranch("conflicts-only", "BEHIND", true)).toBe(false);
  });

  test("refreshes behind pull requests only when policy or protection requires it", () => {
    expect(shouldRefreshDeliveryBranch("auto", "BEHIND", true)).toBe(true);
    expect(shouldRefreshDeliveryBranch("always", "BEHIND", false)).toBe(true);
    expect(shouldRefreshDeliveryBranch("never", "BEHIND", true)).toBe(false);
  });

  test("does not refresh clean or unknown merge states", () => {
    for (const state of ["CLEAN", "HAS_HOOKS", "UNSTABLE", "UNKNOWN", ""]) {
      expect(shouldRefreshDeliveryBranch("auto", state, true)).toBe(false);
      expect(shouldRefreshDeliveryBranch("always", state, true)).toBe(false);
    }
  });
});
