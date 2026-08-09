import type { SavedStrategy, StrategyDraft } from "./strategy-model";

export type PaperAccountAutomation = {
  id: string;
  name: string;
  enabled: boolean;
  dataMode: "daily" | "realtime";
  runTime: string;
  intervalMinutes: number;
  lastRunAt: string | null;
  lastNotifiedAt: string | null;
  lastStatus: "idle" | "succeeded" | "failed" | "skipped" | "retrying";
  lastError: string | null;
  notificationChannelIds: string[];
  notificationChannelNames: string[];
};

export type PaperAccountView = {
  id: string;
  name: string;
  description: string;
  symbol: string;
  stockName: string;
  strategyId: string;
  strategyName: string;
  strategyDefinition: Pick<StrategyDraft, "entryLogic" | "exitLogic" | "entryRules" | "exitRules">;
  strategyVersion: number;
  strategySnapshotHash: string;
  initialCapital: number;
  cash: number;
  realizedPnl: number;
  positionPercent: number;
  stopLoss: number;
  takeProfit: number;
  status: "active" | "paused";
  lastPrice: number | null;
  lastValuationDate: string | null;
  createdAt: string;
  updatedAt: string;
  position: null | {
    id: string;
    symbol: string;
    stockName: string;
    shares: number;
    averageCost: number;
    lastPrice: number;
    openedAt: string;
  };
  trades: Array<{
    id: string;
    action: "buy" | "sell";
    shares: number;
    executionPrice: number;
    commission: number;
    realizedPnl: number;
    reason: string;
    executedAt: string;
  }>;
  tradeCount: number;
  snapshots: Array<{
    id: string;
    snapshotDate: string;
    equity: number;
    cash: number;
    marketValue: number;
    totalReturn: number;
  }>;
  metrics: {
    equity: number;
    marketValue: number;
    unrealizedPnl: number;
    realizedPnl: number;
    totalReturn: number;
    dailyReturn: number;
  };
  automation: PaperAccountAutomation | null;
};

export type PaperAccountTaskTarget = {
  id: string;
  name: string;
  symbol: string;
  stockName: string;
  strategy: SavedStrategy;
  stopLoss: number;
  takeProfit: number;
  automation: PaperAccountAutomation | null;
};
