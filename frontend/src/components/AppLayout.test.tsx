import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { AppLayout } from "./AppLayout";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderLayout(permissions: string[] = ["ManageUsers"]) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/api/v1/me/permissions") {
      return Promise.resolve(jsonResponse({ permissions }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <I18nProvider>
          <AppLayout onLogout={() => {}} user={{ display_name: "Admin", email: "admin@example.com" }}>
            <div>content</div>
          </AppLayout>
        </I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AppLayout OpenAPI link placement (OXR-70)", () => {
  it("keeps the OpenAPI schema link out of the primary navigation list", async () => {
    renderLayout();

    const primaryNav = document.querySelector(".nav-links");
    if (!primaryNav) {
      throw new Error("expected the primary nav-links element to be present");
    }
    expect(within(primaryNav as HTMLElement).queryByRole("link", { name: /OpenAPI schema/ })).not.toBeInTheDocument();

    // Projects/Users behavior is unchanged: still present and still the only entries.
    expect(within(primaryNav as HTMLElement).getByRole("link", { name: /Projects/ })).toBeInTheDocument();
    expect(await within(primaryNav as HTMLElement).findByRole("link", { name: /Users/ })).toBeInTheDocument();
  });

  it("still exposes the OpenAPI schema link, in a secondary area", async () => {
    renderLayout();

    const link = await screen.findByRole("link", { name: /OpenAPI schema/ });
    expect(link).toHaveAttribute("href", "/api/openapi.json");
    expect(link.closest(".nav-links")).toBeNull();
    expect(link.closest(".sidebar-secondary-links")).not.toBeNull();
  });
});
