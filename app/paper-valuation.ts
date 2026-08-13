export function shouldApplyPaperValuation(currentDate: string | null, incomingDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(incomingDate)) return false;
  if (!currentDate || !/^\d{4}-\d{2}-\d{2}$/.test(currentDate)) return true;
  return incomingDate >= currentDate;
}
