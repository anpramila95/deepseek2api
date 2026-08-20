const MESSAGE_FREQUENCY_PATTERN = /消息发送过于频繁[\s，,、:：]*请稍后重试/;

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 30_000;

function getErrorMessages(error) {
  const messages = [];
  let current = error;

  for (let depth = 0; current && depth < 5; depth += 1) {
    messages.push(typeof current === "string" ? current : current.message);
    current = typeof current === "object" ? current.cause : null;
  }

  return messages.filter((message) => typeof message === "string");
}

function wait(milliseconds) {
  if (!milliseconds) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function isDeepseekMessageFrequencyError(error) {
  return getErrorMessages(error).some((message) => MESSAGE_FREQUENCY_PATTERN.test(message));
}

/**
 * Retry only DeepSeek's specific "message sent too frequently" failure. The
 * caller owns account selection so retries stay inside the same API account
 * pool (owner-scoped or shared) as the original request.
 */
export async function withDeepseekMessageFrequencyRetry({
  account,
  maxRetries = DEFAULT_MAX_RETRIES,
  onRetry,
  operation,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  selectNextAccount,
  sleep = wait
}) {
  let activeAccount = account;

  for (let retryCount = 0; ; retryCount += 1) {
    try {
      return await operation(activeAccount, { retryCount });
    } catch (error) {
      if (!isDeepseekMessageFrequencyError(error) || retryCount >= maxRetries) {
        throw error;
      }

      const nextRetryCount = retryCount + 1;
      await onRetry?.({
        account: activeAccount,
        error,
        maxRetries,
        retryCount: nextRetryCount,
        retryDelayMs
      });
      await sleep(retryDelayMs);
      activeAccount = await selectNextAccount?.(activeAccount, {
        error,
        maxRetries,
        retryCount: nextRetryCount
      }) ?? activeAccount;
    }
  }
}

export const DEEPSEEK_MESSAGE_FREQUENCY_RETRY_DEFAULTS = Object.freeze({
  maxRetries: DEFAULT_MAX_RETRIES,
  retryDelayMs: DEFAULT_RETRY_DELAY_MS
});
