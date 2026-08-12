export type PaperBuyOrder = {
  allocation: number;
  executionPrice: number;
  shares: number;
  grossAmount: number;
  commission: number;
  requiredForOneLot: number;
  minimumPositionPercent: number;
};

export function calculatePaperBuyOrder(input: {
  cash: number;
  positionPercent: number;
  signalPrice: number;
  commissionRate: number;
  slippageRate: number;
}): PaperBuyOrder {
  const cash = Math.max(0, input.cash);
  const positionPercent = Math.min(100, Math.max(0, input.positionPercent));
  const executionPrice = input.signalPrice * (1 + input.slippageRate);
  const allocation = Math.min(cash, cash * positionPercent / 100);
  let shares = executionPrice > 0 ? Math.floor(allocation / executionPrice / 100) * 100 : 0;
  let grossAmount = shares * executionPrice;
  let commission = shares ? Math.max(5, grossAmount * input.commissionRate) : 0;
  while (shares >= 100 && grossAmount + commission > allocation) {
    shares -= 100;
    grossAmount = shares * executionPrice;
    commission = shares ? Math.max(5, grossAmount * input.commissionRate) : 0;
  }
  const oneLotGross = Math.max(0, executionPrice) * 100;
  const requiredForOneLot = oneLotGross + (oneLotGross ? Math.max(5, oneLotGross * input.commissionRate) : 0);
  const minimumPositionPercent = cash > 0 ? Math.min(101, Math.ceil(requiredForOneLot / cash * 100)) : 101;
  return { allocation, executionPrice, shares, grossAmount, commission, requiredForOneLot, minimumPositionPercent };
}
