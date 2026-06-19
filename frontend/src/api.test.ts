import { describe, expect, it, vi } from "vitest";

import { apiDelete, apiGet, buildErrorMessage } from "./api";

describe("api helpers", () => {
  it("returns parsed JSON for successful requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(apiGet<{ ok: boolean }>("/api/test")).resolves.toEqual({ ok: true });
  });

  it("throws structured errors for failed requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "Conflict",
              message: "Duplicate entry.",
            },
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(apiDelete("/api/test")).rejects.toMatchObject({
      message: "Duplicate entry.",
      status: 409,
      code: "Conflict",
    });
  });

  it("extracts readable messages from unknown error values", () => {
    expect(buildErrorMessage(new Error("boom"))).toBe("boom");
    expect(buildErrorMessage({ message: "from object" })).toBe("from object");
    expect(buildErrorMessage(null)).toBe("An unexpected error occurred.");
  });
});
