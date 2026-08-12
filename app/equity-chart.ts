const niceSteps = [1, 2, 2.5, 5, 10];

function niceStep(rawStep: number) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  return (niceSteps.find((candidate) => candidate >= normalized) ?? 10) * magnitude;
}

export type EquityAxisScale = {
  minimum: number;
  maximum: number;
  step: number;
  ticks: number[];
};

export function calculateEquityAxisScale(values: number[]): EquityAxisScale | null {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return null;
  const observedMinimum = Math.min(...finiteValues);
  const observedMaximum = Math.max(...finiteValues);
  const spread = observedMaximum - observedMinimum;

  if (spread === 0) {
    const step = niceStep(Math.max(Math.abs(observedMaximum) * .00125, .01));
    const center = Math.round(observedMaximum / step) * step;
    const minimum = center - step * 2;
    const maximum = center + step * 2;
    return { minimum, maximum, step, ticks: Array.from({ length: 5 }, (_, index) => minimum + step * index) };
  }

  const padding = spread * .12;
  const paddedMinimum = observedMinimum - padding;
  const paddedMaximum = observedMaximum + padding;
  const step = niceStep((paddedMaximum - paddedMinimum) / 4);
  const minimum = Math.floor(paddedMinimum / step) * step;
  const maximum = Math.ceil(paddedMaximum / step) * step;
  const tickCount = Math.round((maximum - minimum) / step);
  return { minimum, maximum, step, ticks: Array.from({ length: tickCount + 1 }, (_, index) => minimum + step * index) };
}

function decimalsFor(step: number) {
  if (step >= 1) return 0;
  return Math.min(4, Math.max(0, Math.ceil(-Math.log10(step))));
}

export function formatEquityAxisMoney(value: number, step: number) {
  const absolute = Math.abs(value);
  if (absolute >= 100_000_000) {
    const digits = decimalsFor(step / 100_000_000);
    return `¥${(value / 100_000_000).toFixed(digits)}亿`;
  }
  if (absolute >= 1_000_000) {
    const digits = decimalsFor(step / 10_000);
    return `¥${(value / 10_000).toFixed(digits)}万`;
  }
  const digits = decimalsFor(step);
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
