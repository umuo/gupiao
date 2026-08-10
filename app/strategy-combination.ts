import { signalFor, type Kline, type SignalStrategy } from "./strategy-engine";

export type NamedSignalStrategy = SignalStrategy & { id: string; name: string };

export function combinedSignalFor(strategies: NamedSignalStrategy[], bars: Kline[], index: number, action: "buy" | "sell") {
  const matches = strategies.flatMap((strategy) => {
    const signal = signalFor(strategy, bars, index, action);
    return signal.active ? [{ id: strategy.id, name: strategy.name, reason: signal.reason }] : [];
  });
  return {
    active: matches.length > 0,
    strategyIds: matches.map((match) => match.id),
    strategyNames: matches.map((match) => match.name),
    reason: matches.map((match) => `【${match.name}】${match.reason}`).join("；"),
  };
}
