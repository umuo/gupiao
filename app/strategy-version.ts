import type { StrategyDraft } from "./strategy-model";

export function strategyDefinitionJson(strategy: Pick<StrategyDraft, "entryLogic" | "exitLogic" | "entryRules" | "exitRules">) {
  return JSON.stringify({
    entryLogic: strategy.entryLogic,
    exitLogic: strategy.exitLogic,
    entryRules: strategy.entryRules,
    exitRules: strategy.exitRules,
  });
}

export async function strategySnapshotHash(strategy: Pick<StrategyDraft, "entryLogic" | "exitLogic" | "entryRules" | "exitRules">) {
  const bytes = new TextEncoder().encode(strategyDefinitionJson(strategy));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function strategyVersionNumber(value: unknown) {
  if (!value || typeof value !== "object") return 1;
  const version = Number((value as { version?: unknown }).version ?? 1);
  return Number.isInteger(version) && version > 0 ? Math.min(version, 1_000_000) : 1;
}
