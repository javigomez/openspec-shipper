import type { DeliveryRefreshPolicy } from "../config/shipper-config.js";

export type PullRequestMergeState = "BEHIND" | "DIRTY" | string;

export function shouldRefreshDeliveryBranch(
  policy: DeliveryRefreshPolicy,
  mergeState: PullRequestMergeState,
  baseRequiresCurrentBranch: boolean,
): boolean {
  if (policy === "never") {
    return false;
  }

  const normalizedState = mergeState.toUpperCase();
  if (normalizedState === "DIRTY") {
    return true;
  }

  if (normalizedState !== "BEHIND" || policy === "conflicts-only") {
    return false;
  }

  return policy === "always" || (policy === "auto" && baseRequiresCurrentBranch);
}
