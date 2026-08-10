import { sanitizeStrategyDraft, type SavedStrategy, type StrategyDraft } from "./strategy-model";

export type StrategySnapshot = SavedStrategy & { version: number; contentHash: string };

type LegacyStrategySnapshot = {
  id: string;
  name: string;
  definition: string;
  version: number;
  contentHash: string;
};

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

export async function createStrategySnapshots(value: unknown, fallbackId = ""): Promise<StrategySnapshot[]> {
  const rawItems = Array.isArray(value) ? value : value ? [value] : [];
  const snapshots: StrategySnapshot[] = [];
  for (const raw of rawItems.slice(0, 8)) {
    const strategy = sanitizeStrategyDraft(raw);
    const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const id = String(input.id ?? fallbackId).trim().slice(0, 100);
    if (!id || snapshots.some((item) => item.id === id)) continue;
    snapshots.push({
      ...strategy,
      id,
      version: strategyVersionNumber(raw),
      contentHash: await strategySnapshotHash(strategy),
    });
  }
  if (!snapshots.length) throw new Error("请至少选择一个有效策略");
  return snapshots;
}

export function parseStrategySnapshots(value: string | null | undefined, legacy: LegacyStrategySnapshot): StrategySnapshot[] {
  try {
    const raw = JSON.parse(value || "[]") as unknown;
    if (Array.isArray(raw) && raw.length) {
      const snapshots = raw.slice(0, 8).map((item) => {
        const strategy = sanitizeStrategyDraft(item);
        const stored = item as Record<string, unknown>;
        const id = String(stored.id ?? "").trim().slice(0, 100);
        if (!id) throw new Error("策略快照缺少 ID");
        return {
          ...strategy,
          id,
          version: strategyVersionNumber(item),
          contentHash: String(stored.contentHash ?? "legacy").slice(0, 128) || "legacy",
        };
      });
      if (snapshots.length) return snapshots;
    }
  } catch {
    // Fall through to the legacy single-strategy columns.
  }
  const definition = JSON.parse(legacy.definition) as Record<string, unknown>;
  const strategy = sanitizeStrategyDraft({ name: legacy.name, description: "历史策略快照", tag: "模拟盘", ...definition });
  return [{ ...strategy, id: legacy.id, version: legacy.version, contentHash: legacy.contentHash }];
}

export function strategySnapshotsJson(snapshots: StrategySnapshot[]) {
  return JSON.stringify(snapshots);
}
