import { config } from "../config.js";
import { buildAnonymousPayload, buildSessionPayload } from "../services/app-payload-service.js";
import { getProtocolManifest } from "../services/deepseek-protocol.js";
import { loginAsAdmin, loginAsLocalUser, registerLocalUserSession } from "../services/auth-service.js";
import { deleteSession } from "../services/session-service.js";
import { checkAuthRateLimit, recordFailedAuth, resetAuthRateLimit } from "../services/auth-rate-limit-service.js";
import { clearCookie, parseJsonBody, readRequestBody, sendError, sendJson, setCookie } from "../utils/http.js";
import { solveWaf } from "../services/waf-solver.js";

function getClientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }
  return request.socket?.remoteAddress || "127.0.0.1";
}

async function readJsonRequest(request) {
  return parseJsonBody(await readRequestBody(request)) ?? {};
}

function sendSessionPayload(response, session) {
  setCookie(response, config.sessionCookieName, session.id, config.sessionTtlMs / 1000);
  sendJson(response, 200, buildSessionPayload(session));
}

async function handleLoginRequest(request, response) {
  const ip = getClientIp(request);
  const rateLimit = checkAuthRateLimit(ip);
  if (!rateLimit.allowed) {
    response.setHeader("retry-after", String(rateLimit.retryAfterSeconds));
    sendError(response, 429, `Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau ${rateLimit.retryAfterSeconds} giây.`);
    return true;
  }

  const body = await readJsonRequest(request);
  const adminSession = await loginAsAdmin(body.username, body.password);

  if (adminSession) {
    resetAuthRateLimit(ip);
    sendSessionPayload(response, adminSession);
    return true;
  }

  try {
    const localSession = await loginAsLocalUser(body.username, body.password);
    if (!localSession) {
      recordFailedAuth(ip);
      sendError(response, 401, "Invalid username or password");
      return true;
    }

    resetAuthRateLimit(ip);
    sendSessionPayload(response, localSession);
  } catch (error) {
    recordFailedAuth(ip);
    sendError(response, 403, error.message);
  }

  return true;
}

async function handleRegisterRequest(request, response) {
  const body = await readJsonRequest(request);

  try {
    const session = await registerLocalUserSession({
      inviteCode: body.inviteCode,
      password: body.password,
      username: body.username
    });
    sendSessionPayload(response, session);
  } catch (error) {
    sendError(response, 400, error.message);
  }

  return true;
}

function handleLogoutRequest(response, session) {
  if (session) {
    deleteSession(session.id);
  }

  clearCookie(response, config.sessionCookieName);
  sendJson(response, 200, { ok: true });
  return true;
}

export async function handlePublicApiRequest({ request, response, session, url }) {
  if (url.pathname === "/api/token") {
    try {
      const siteUrl = `${config.deepseekBaseUrl}/sign_in`;
      const result = await solveWaf(siteUrl);
      sendJson(response, 200, {
        token: result.token,
        cookie: result.cookie
      });
    } catch (error) {
      sendError(response, 500, error.message);
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/me") {
    sendJson(response, 200, session ? buildSessionPayload(session) : buildAnonymousPayload());
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/discovery") {
    const protocol = getProtocolManifest();
    sendJson(response, 200, {
      paths: [...config.allowedProxyPaths].sort(),
      protocol
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/protocol") {
    sendJson(response, 200, getProtocolManifest());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    return handleLoginRequest(request, response);
  }

  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    return handleRegisterRequest(request, response);
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    return handleLogoutRequest(response, session);
  }

  return false;
}
