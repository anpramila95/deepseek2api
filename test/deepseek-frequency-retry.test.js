import assert from "node:assert/strict";
import test from "node:test";

import {
  DEEPSEEK_MESSAGE_FREQUENCY_RETRY_DEFAULTS,
  isDeepseekMessageFrequencyError,
  withDeepseekMessageFrequencyRetry
} from "../src/services/deepseek-frequency-retry.js";

const FREQUENCY_MESSAGE = "Quá nhiều yêu cầu, thử lại sau";

test("only the specific DeepSeek message-frequency error is retryable", () => {
  assert.equal(isDeepseekMessageFrequencyError(new Error(FREQUENCY_MESSAGE)), true);
  assert.equal(
    isDeepseekMessageFrequencyError(new Error("Quá nhiều yêu cầu, thử lại sau")),
    true
  );
  assert.equal(isDeepseekMessageFrequencyError(new Error("Rate limit reached")), false);
  assert.equal(isDeepseekMessageFrequencyError(new Error("服务繁忙，请稍后重试")), false);
});

test("message-frequency failures wait 30 seconds and retry three times", async () => {
  const accounts = [
    { id: "account-a" },
    { id: "account-b" },
    { id: "account-c" }
  ];
  const attempts = [];
  const delays = [];
  const retries = [];
  const terminalError = new Error(FREQUENCY_MESSAGE);

  await assert.rejects(
    withDeepseekMessageFrequencyRetry({
      account: accounts[0],
      onRetry: ({ retryCount }) => retries.push(retryCount),
      operation: async (account) => {
        attempts.push(account.id);
        throw terminalError;
      },
      selectNextAccount: (account) => {
        const index = accounts.findIndex((candidate) => candidate.id === account.id);
        return accounts[(index + 1) % accounts.length];
      },
      sleep: async (delayMs) => delays.push(delayMs)
    }),
    terminalError
  );

  assert.deepEqual(attempts, ["account-a", "account-b", "account-c", "account-a"]);
  assert.deepEqual(retries, [1, 2, 3]);
  assert.deepEqual(delays, [30_000, 30_000, 30_000]);
  assert.deepEqual(DEEPSEEK_MESSAGE_FREQUENCY_RETRY_DEFAULTS, {
    maxRetries: 3,
    retryDelayMs: 30_000
  });
});

test("unrelated upstream failures are returned without waiting or switching accounts", async () => {
  let selectCount = 0;
  let sleepCount = 0;
  const error = new Error("Rate limit reached");

  await assert.rejects(
    withDeepseekMessageFrequencyRetry({
      account: { id: "account-a" },
      operation: async () => {
        throw error;
      },
      selectNextAccount: () => {
        selectCount += 1;
        return { id: "account-b" };
      },
      sleep: async () => {
        sleepCount += 1;
      }
    }),
    error
  );

  assert.equal(selectCount, 0);
  assert.equal(sleepCount, 0);
});
