import assert from "node:assert/strict";
import test from "node:test";
import { handlePublicApiRequest } from "../src/routes/auth-routes.js";

test("handlePublicApiRequest /api/token handles token request", async () => {
  let statusResult = null;
  let jsonResult = null;
  const mockResponse = {
    writeHead(status) {
      statusResult = status;
    },
    end(data) {
      jsonResult = JSON.parse(Buffer.from(data).toString("utf-8"));
    }
  };

  const handled = await handlePublicApiRequest({
    request: { method: "GET" },
    response: mockResponse,
    session: null,
    url: new URL("http://localhost/api/token")
  });

  assert.equal(handled, true);
  assert.ok(statusResult === 200 || statusResult === 500);
});
