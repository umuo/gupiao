import assert from "node:assert/strict";
import test from "node:test";
import { dingtalkMessageTemplate, defaultMessageTemplate, feishuMessageTemplate, tradeNotificationDetails, tradeNotificationExecutionStatus } from "../app/notification-model.ts";

test("includes the actual share count in executed buy and sell notifications", () => {
  assert.deepEqual(tradeNotificationDetails("buy", { executed: true, shares: 1200 }), {
    shares: 1200,
    quantityText: "1,200 股",
    actionText: "买入 1,200 股",
    tradeSummary: "买入 1,200 股",
  });
  assert.deepEqual(tradeNotificationDetails("sell", { executed: true, shares: 800 }), {
    shares: 800,
    quantityText: "800 股",
    actionText: "卖出 800 股",
    tradeSummary: "卖出 800 股",
  });
});

test("makes rejected and signal-only notifications explicit about their quantity", () => {
  assert.equal(tradeNotificationDetails("buy", { executed: false }).quantityText, "0 股（未成交）");
  assert.equal(tradeNotificationDetails("sell", null).quantityText, "未执行成交（仅策略信号）");
  assert.equal(tradeNotificationExecutionStatus({ executed: false }), "rejected");
  assert.equal(tradeNotificationExecutionStatus(null), "signal-only");
});

test("reports an idempotent retry as the already recorded execution", () => {
  const execution = { executed: false, duplicate: true, shares: 100 };
  assert.equal(tradeNotificationExecutionStatus(execution), "executed");
  assert.equal(tradeNotificationDetails("sell", execution).tradeSummary, "卖出 100 股");
});

test("adds a dedicated quantity field to all new notification templates", () => {
  assert.match(defaultMessageTemplate, /{{quantityText}}/);
  assert.match(dingtalkMessageTemplate, /成交数量：{{quantityText}}/);
  assert.match(feishuMessageTemplate, /成交数量：{{quantityText}}/);
});
