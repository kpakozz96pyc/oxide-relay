import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useTranslation } from "./i18n";

function TranslatedLabel() {
  const { t } = useTranslation();
  return <span>{t("app.name")}</span>;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("I18nProvider live translation loading (OXR-61)", () => {
  it("fetches the namespace file without a mismatched delivery-metadata version, so it doesn't fall back to bundled messages", async () => {
    let namespaceRequestSearch: string | null = null;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");

      if (url.pathname === "/api/v1/projects/oxide-relay/delivery-metadata") {
        return new Response(
          JSON.stringify({
            // An environment-wide version hash, deliberately different from anything the
            // namespace-scoped static endpoint would ever compute for "common" alone.
            version: "environment-wide-hash",
            languages: [{ code: "en", name: "English" }],
            namespaces: [{ name: "common" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.pathname === "/static/oxide-relay/production/en/common.json") {
        namespaceRequestSearch = url.search;
        if (url.searchParams.has("v")) {
          // Mirrors the real backend's static_namespace_file: a `v` that doesn't match
          // the namespace's own version is rejected outright (404), regardless of why
          // it was wrong.
          return new Response(
            JSON.stringify({ error: { code: "NotFound", message: "stale version" } }),
            { status: 404, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ "app.name": "OxideRelay Live" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected request: ${url.pathname}${url.search}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider>
        <TranslatedLabel />
      </I18nProvider>,
    );

    expect(await screen.findByText("OxideRelay Live")).toBeInTheDocument();
    expect(namespaceRequestSearch).toBe("");
  });
});
