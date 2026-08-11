export type IndicatorBar = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
};

export function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

export function movingAverage(bars: IndicatorBar[], index: number, length: number) {
  if (index + 1 < length) return null;
  return average(bars.slice(index - length + 1, index + 1).map((bar) => bar.close));
}

const seriesCache = new WeakMap<IndicatorBar[], Map<string, number[]>>();

function cachedSeries(bars: IndicatorBar[], key: string, build: () => number[]) {
  let cache = seriesCache.get(bars);
  if (!cache) {
    cache = new Map();
    seriesCache.set(bars, cache);
  }
  const existing = cache.get(key);
  if (existing) return existing;
  const created = build();
  cache.set(key, created);
  return created;
}

function emaValues(values: number[], length: number) {
  const multiplier = 2 / (length + 1);
  let current = values[0] ?? 0;
  return values.map((value, index) => {
    current = index ? value * multiplier + current * (1 - multiplier) : value;
    return current;
  });
}

export function exponentialMovingAverage(bars: IndicatorBar[], index: number, length: number) {
  if (index + 1 < length) return null;
  return cachedSeries(bars, `ema:${length}`, () => emaValues(bars.map((bar) => bar.close), length))[index] ?? null;
}

export function calculateRsi(bars: IndicatorBar[], index: number, length = 14) {
  if (index < length) return null;
  let gains = 0;
  let losses = 0;
  for (let itemIndex = index - length + 1; itemIndex <= index; itemIndex += 1) {
    const change = bars[itemIndex].close - bars[itemIndex - 1].close;
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

export function macdValue(bars: IndicatorBar[], index: number, part: "dif" | "signal" | "histogram") {
  if (index + 1 < 35) return null;
  const dif = cachedSeries(bars, "macd:dif", () => {
    const ema12 = emaValues(bars.map((bar) => bar.close), 12);
    const ema26 = emaValues(bars.map((bar) => bar.close), 26);
    return ema12.map((value, itemIndex) => value - ema26[itemIndex]);
  });
  const signal = cachedSeries(bars, "macd:signal", () => emaValues(dif, 9));
  if (part === "dif") return dif[index] ?? null;
  if (part === "signal") return signal[index] ?? null;
  return ((dif[index] ?? 0) - (signal[index] ?? 0)) * 2;
}

export function bollingerBand(bars: IndicatorBar[], index: number, side: "upper" | "lower", length = 20, deviations = 2) {
  if (index + 1 < length) return null;
  const closes = bars.slice(index - length + 1, index + 1).map((bar) => bar.close);
  const middle = average(closes);
  const width = standardDeviation(closes) * deviations;
  return side === "upper" ? middle + width : middle - width;
}

export function atrPercent(bars: IndicatorBar[], index: number, length = 14) {
  if (index < length) return null;
  const trueRanges: number[] = [];
  for (let itemIndex = index - length + 1; itemIndex <= index; itemIndex += 1) {
    const bar = bars[itemIndex];
    const previousClose = bars[itemIndex - 1]?.close ?? bar.close;
    trueRanges.push(Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose)));
  }
  return bars[index].close ? average(trueRanges) / bars[index].close * 100 : 0;
}

export function rateOfChange(bars: IndicatorBar[], index: number, length = 20) {
  if (index < length || !bars[index - length]?.close) return null;
  return (bars[index].close / bars[index - length].close - 1) * 100;
}

export function previousExtreme(bars: IndicatorBar[], index: number, side: "high" | "low", length = 20) {
  if (index < length) return null;
  const values = bars.slice(index - length, index).map((bar) => bar[side]);
  return side === "high" ? Math.max(...values) : Math.min(...values);
}

export function activityRatio(bars: IndicatorBar[], index: number, field: "volume" | "amount", length = 20) {
  if (index < length) return null;
  const baseline = average(bars.slice(index - length, index).map((bar) => bar[field]));
  return baseline ? bars[index][field] / baseline : 0;
}

export function closeVolatilityPercent(bars: IndicatorBar[], index: number, length = 20) {
  if (index + 1 < length) return null;
  const sample = bars.slice(index - length + 1, index + 1);
  const returns = sample.slice(1).map((item, offset) => item.close / sample[offset].close - 1);
  return standardDeviation(returns) * 100;
}
