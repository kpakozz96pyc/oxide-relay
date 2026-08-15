import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useTranslation } from "./i18n";

function TranslatedLabel() {
  const { t } = useTranslation();
  return <span>{t("app.name")}</span>;
}

function PluralCounts() {
  const { setLanguage, tCount } = useTranslation();
  return (
    <div>
      <button onClick={() => setLanguage("ru")} type="button">
        Switch to Russian
      </button>
      <span data-testid="count-1">{tCount("project.pagination.terms", 1)}</span>
      <span data-testid="count-2">{tCount("project.pagination.terms", 2)}</span>
      <span data-testid="count-5">{tCount("project.pagination.terms", 5)}</span>
    </div>
  );
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

describe("useTranslation().tCount (OXR-67)", () => {
  it("picks the grammatically correct plural form per language and count", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))),
    );

    render(
      <I18nProvider>
        <PluralCounts />
      </I18nProvider>,
    );

    expect(await screen.findByTestId("count-1")).toHaveTextContent("term");
    expect(screen.getByTestId("count-2")).toHaveTextContent("terms");
    expect(screen.getByTestId("count-5")).toHaveTextContent("terms");

    await user.click(screen.getByRole("button", { name: "Switch to Russian" }));

    expect(await screen.findByTestId("count-1")).toHaveTextContent("термин");
    expect(screen.getByTestId("count-2")).toHaveTextContent("термина");
    expect(screen.getByTestId("count-5")).toHaveTextContent("терминов");
  });
});
