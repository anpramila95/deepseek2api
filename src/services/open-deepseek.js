import { launch } from "cloakbrowser";

function resolveBrowserProxy(proxy) {
  const value = String(proxy ?? "").trim();
  if (!value) return undefined;

  const url = new URL(value.includes("://") ? value : `http://${value}`);
  return {
    server: `${url.protocol}//${url.host}`,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {})
  };
}

export async function generateDeepseekDeviceIdFromBrowser(proxy) {
  const browser = await launch({
    headless: true,
    humanize: true,
    timezone: "Asia/Ho_Chi_Minh",
    locale: "vi-VN",
    ...(proxy ? { proxy: resolveBrowserProxy(proxy) } : {})
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
    });
    const page = await context.newPage();

    await page.goto("https://chat.deepseek.com/sign_in", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await page.mouse.move(120, 180);
    await page.waitForTimeout(1500);

    return await page
      .waitForFunction(
        () => {
          return new Promise((resolve) => {
            const sdk = window.SMSdk || window._smSdk;
            if (!sdk || typeof sdk.getDeviceId !== "function") return;

            try {
              const res = sdk.getDeviceId((id) => {
                if (id) resolve(id);
              });

              if (res && typeof res.then === "function") {
                res.then((id) => id && resolve(id));
              } else if (typeof res === "string" && res.length > 5) {
                resolve(res);
              }
            } catch {
              // SDK chưa sẵn sàng, chờ lượt polling tiếp theo.
            }
          });
        },
        null,
        { timeout: 35_000, polling: 300 },
      )
      .then((handle) => handle.jsonValue());
  } finally {
    await browser.close();
  }
}
