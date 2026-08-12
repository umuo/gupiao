export function repeatedNotificationAlreadySent(signalKey: string, lastSignalKey: string | null, lastNotifiedAt: string | null) {
  return signalKey === lastSignalKey && Boolean(lastNotifiedAt);
}

export function skipRepeatedSignalBeforeExecution(notificationAlreadySent: boolean, hasPaperAccount: boolean) {
  return notificationAlreadySent && !hasPaperAccount;
}

export function notificationSignalKeyAfterDelivery(signalKey: string, previousSignalKey: string | null, succeeded: number) {
  if (succeeded > 0) return signalKey;
  return previousSignalKey === signalKey ? null : previousSignalKey;
}
