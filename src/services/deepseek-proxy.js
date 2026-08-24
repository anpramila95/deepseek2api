import { config, resolveDeepseekApiPath } from "../config.js";
import { createSafeUpstreamError } from "../utils/privacy.js";
import { solvePowChallenge } from "./pow-solver.js";
import { createBaseHeaders, refreshAccountToken } from "./deepseek-auth.js";
import { resolveProxyDispatcher } from "./proxy-dispatcher.js";
import {
  classifyProtocolResponse,
  createProtocolRequestContext,
  resolveRetryAfterMs,
} from "./deepseek-protocol.js";
import {
  attachShumeiVerificationToBody,
  inspectResponseForCaptcha,
} from "./captcha-service.js";
import { isInvalidPowResponseText, isPowChallengeFresh } from "./pow-utils.js";

const powChallengeCache = new Map();

function buildTargetUrl(path, query) {
  const url = new URL(resolveDeepseekApiPath(path), config.deepseekBaseUrl);

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url;
}

function getPowCacheKey(account, path) {
  return `${account.id || account.deepseekUserId || account.loginValue}:${path}`;
}

function isFreshChallenge(challenge) {
  return isPowChallengeFresh(challenge);
}

async function fetchPowChallenge(account, path) {
  const requestContext = createProtocolRequestContext(
    account,
    "/chat/create_pow_challenge",
    {
      method: "POST",
    },
  );
  const response = await fetch(
    `${config.deepseekBaseUrl}${resolveDeepseekApiPath("/chat/create_pow_challenge")}`,
    {
      method: "POST",
      headers: createBaseHeaders(
        account.token,
        {
          ...requestContext.headers,
          "content-type": "application/json",
        },
        requestContext.profile,
      ),
      body: JSON.stringify({ target_path: path }),
      dispatcher: resolveProxyDispatcher(account?.proxy),
    },
  );

  let payload;
  let responseText = "";
  try {
    responseText = await response.text();
    payload = JSON.parse(responseText);
  } catch {
    throw createSafeUpstreamError(
      "PoW challenge request failed: unable to parse upstream response",
      {
        status: response.status,
        body: responseText,
      },
    );
  }
  const challenge = payload?.data?.biz_data?.challenge;
  if (!response.ok || payload?.data?.biz_code !== 0 || !challenge) {
    throw new Error(
      payload?.data?.biz_msg ||
        payload?.msg ||
        "Failed to create PoW challenge",
    );
  }

  return challenge;
}

export async function fetchPowGuestChallenge(targetPath = "/v0/users/create_email_verification_code") {
  const requestContext = createProtocolRequestContext(
    null,
    "/users/create_guest_challenge",
    {
      method: "POST",
    },
  );
  const response = await fetch(
    `${config.deepseekBaseUrl}/api/v0/users/create_guest_challenge`,
    {
      method: "POST",
      headers: createBaseHeaders(
        undefined,
        {
          ...requestContext.headers,
          "content-type": "application/json",
        },
        requestContext.profile,
      ),
      body: JSON.stringify({ target_path: targetPath }),
    },
  );

  let payload;
  let responseText = "";
  try {
    responseText = await response.text();
    payload = JSON.parse(responseText);
  } catch {
    throw createSafeUpstreamError(
      "Guest PoW challenge request failed: unable to parse upstream response",
      { status: response.status, body: responseText },
    );
  }

  const challenge = payload?.data?.biz_data?.guest_challenge;
  if (!response.ok || payload?.code !== 0 || payload?.data?.biz_code !== 0 || !challenge) {
    throw new Error(
      payload?.data?.biz_msg || payload?.msg || "Failed to create guest PoW challenge",
    );
  }

  return challenge;
}

export async function createGuestPowHeader(targetPath = "/v0/users/create_email_verification_code") {
  const challenge = await fetchPowGuestChallenge(targetPath);
  const expireAt = challenge?.expire_at ?? challenge?.expireAt;
  const solved = await solvePowChallenge({
    ...challenge,
    expire_at: expireAt,
    expireAt,
  });

  return Buffer.from(JSON.stringify({
    algorithm: solved.algorithm,
    challenge: solved.challenge,
    salt: solved.salt,
    answer: solved.answer,
    signature: solved.signature,
    target_path: targetPath,
  })).toString("base64");
}

async function getPowChallenge(account, path, { forceFresh = false } = {}) {
  const cacheKey = getPowCacheKey(account, path);
  if (forceFresh) {
    powChallengeCache.delete(cacheKey);
  }

  const cached = powChallengeCache.get(cacheKey);
  if (isFreshChallenge(cached)) {
    powChallengeCache.delete(cacheKey);
    return cached;
  }

  powChallengeCache.delete(cacheKey);
  return fetchPowChallenge(account, path);
}

function prefetchPowChallenge(account, path) {
  if (!config.powPrefetchCount) {
    return;
  }

  const cacheKey = getPowCacheKey(account, path);
  if (isFreshChallenge(powChallengeCache.get(cacheKey))) {
    return;
  }

  fetchPowChallenge(account, path)
    .then((challenge) => {
      if (isFreshChallenge(challenge)) {
        powChallengeCache.set(cacheKey, challenge);
      }
    })
    .catch(() => {
      powChallengeCache.delete(cacheKey);
    });
}

function invalidatePowChallenge(account, path) {
  powChallengeCache.delete(getPowCacheKey(account, path));
}

async function createPowHeader(account, path, { forceFresh = false } = {}) {
  const challenge = await getPowChallenge(account, path, { forceFresh });
  const expireAt = challenge?.expire_at ?? challenge?.expireAt;
  const solved = await solvePowChallenge({
    ...challenge,
    expire_at: expireAt,
    expireAt,
  });

  prefetchPowChallenge(account, path);

  return Buffer.from(
    JSON.stringify({
      algorithm: solved.algorithm,
      challenge: solved.challenge,
      salt: solved.salt,
      answer: solved.answer,
      signature: solved.signature,
      target_path: path,
    }),
  ).toString("base64");
}

async function responseContainsInvalidPow(response) {
  const contentType = response?.headers?.get?.("content-type") ?? "";
  if (
    !response ||
    contentType.includes("text/event-stream") ||
    typeof response.clone !== "function"
  ) {
    return false;
  }

  try {
    return isInvalidPowResponseText(await response.clone().text());
  } catch {
    return false;
  }
}

async function performRequest({
  account,
  method,
  path,
  query,
  body,
  headers,
  forceFreshPow = false,
}) {
  const targetPath = resolveDeepseekApiPath(path);
  const requestContext = createProtocolRequestContext(account, targetPath, {
    method,
  });
  const finalHeaders = createBaseHeaders(
    account.token,
    {
      ...requestContext.headers,
      ...headers,
    },
    requestContext.profile,
  );

  if (config.powProtectedPaths.has(targetPath)) {
    finalHeaders["X-DS-PoW-Response"] = await createPowHeader(
      account,
      targetPath,
      {
        forceFresh: forceFreshPow,
      },
    );
  }

  const response = await fetch(buildTargetUrl(targetPath, query), {
    method,
    headers: finalHeaders,
    dispatcher: resolveProxyDispatcher(account?.proxy),
    body: attachShumeiVerificationToBody({
      account,
      body,
      headers: finalHeaders,
    }),
  });

  if (
    !forceFreshPow &&
    config.powProtectedPaths.has(targetPath) &&
    (await responseContainsInvalidPow(response))
  ) {
    invalidatePowChallenge(account, targetPath);
    return performRequest({
      account,
      method,
      path,
      query,
      body,
      headers,
      forceFreshPow: true,
    });
  }

  return response;
}

async function maybeRefreshAccount(response, account) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return { refreshedAccount: account, response };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const payloadText = buffer.toString("utf8");
  let payload = null;
  if (contentType.includes("application/json")) {
    try {
      payload = JSON.parse(payloadText);
    } catch {
      // Response body truncated or malformed — treat as non-refreshable
    }
  }
  const classification = classifyProtocolResponse({
    status: response.status,
    payload,
    headers: response.headers,
  });
  const bizCode = payload?.data?.biz_code ?? payload?.code;
  const shouldRefresh =
    classification.kind === "auth" || bizCode === 40002 || bizCode === 40003;

  if (!shouldRefresh) {
    const responseHeaders = new Headers(response.headers);
    if (classification.kind === "rate_limit") {
      responseHeaders.set(
        "x-deepseek-retry-after-ms",
        String(resolveRetryAfterMs(response.headers, 0)),
      );
    }
    return {
      refreshedAccount: account,
      response: new Response(buffer, {
        headers: responseHeaders,
        status: response.status,
        statusText: response.statusText,
      }),
    };
  }

  const refreshedAccount = await refreshAccountToken(account);
  return { refreshedAccount, response: null };
}

export async function proxyDeepseekRequest(options) {
  const { account } = options;
  const initialResponse = await performRequest(options);
  const firstPass = await maybeRefreshAccount(initialResponse, account);

  if (firstPass.response) {
    const captchaPass = await inspectResponseForCaptcha({
      account: firstPass.refreshedAccount,
      response: firstPass.response,
    });
    if (!captchaPass.retry) {
      return {
        refreshedAccount: firstPass.refreshedAccount,
        response: captchaPass.response,
      };
    }

    const retriedResponse = await performRequest({
      ...options,
      account: captchaPass.account,
    });
    return {
      refreshedAccount: captchaPass.account,
      response: retriedResponse,
    };
  }

  const retriedResponse = await performRequest({
    ...options,
    account: firstPass.refreshedAccount,
  });

  const secondPass = await maybeRefreshAccount(
    retriedResponse,
    firstPass.refreshedAccount,
  );
  if (!secondPass.response) {
    throw new Error("DeepSeek token refresh failed");
  }

  const captchaPass = await inspectResponseForCaptcha({
    account: secondPass.refreshedAccount,
    response: secondPass.response,
  });
  if (!captchaPass.retry) {
    return {
      refreshedAccount: secondPass.refreshedAccount,
      response: captchaPass.response,
    };
  }

  const captchaRetriedResponse = await performRequest({
    ...options,
    account: captchaPass.account,
  });

  return {
    refreshedAccount: captchaPass.account,
    response: captchaRetriedResponse,
  };
}
