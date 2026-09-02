import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DeliveryManifest, Environment, Language, Namespace } from "../../api";
import { ProjectDeliveryLinksPanel } from "./ProjectDeliveryLinksPanel";

const environments: Environment[] = [
  { id: "env-1", project_id: "project-1", name: "Production", slug: "production", created_at: "", updated_at: "" },
];

const languages: Language[] = [
  { id: "lang-1", project_id: "project-1", code: "en", name: "English", created_at: "", updated_at: "" },
];

const namespaces: Namespace[] = [
  { id: "ns-1", project_id: "project-1", name: "common", created_at: "", updated_at: "" },
  { id: "ns-2", project_id: "project-1", name: "checkout", created_at: "", updated_at: "" },
];

const manifest: DeliveryManifest = {
  project: "demo-project",
  locale: "en",
  environment: "production",
  locale_bundle_version: "bundle-version-123",
  locale_bundle_url: "/api/v1/projects/demo-project/locales/en?environment=production&v=bundle-version-123",
  namespaces: [
    {
      name: "common",
      version: "namespace-version-456",
      url: "/static/demo-project/production/en/common.json?v=namespace-version-456",
    },
    {
      name: "checkout",
      version: "namespace-version-789",
      url: "/static/demo-project/production/en/checkout.json?v=namespace-version-789",
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPanel() {
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(manifest)));
  vi.stubGlobal("fetch", fetchMock);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ProjectDeliveryLinksPanel
        environments={environments}
        languages={languages}
        namespaces={namespaces}
        projectSlug="demo-project"
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProjectDeliveryLinksPanel version and cache labeling (OXR-71)", () => {
  it("shows content versions separately while linking to stable unversioned endpoints", async () => {
    renderPanel();

    expect(await screen.findByText("bundle-version-123")).toBeInTheDocument();
    expect(screen.getByText("namespace-version-456")).toBeInTheDocument();

    expect(screen.getAllByText("Short-lived (unversioned URL, revalidated via ETag)")).toHaveLength(3);

    expect(screen.getByRole("link", { name: /locales\/en\?environment=production/ })).toHaveAttribute(
      "href",
      "http://localhost:3000/api/v1/projects/demo-project/locales/en?environment=production",
    );
    expect(screen.getByRole("link", { name: /common\.json/ })).toHaveAttribute(
      "href",
      "http://localhost:3000/static/demo-project/production/en/common.json",
    );
    expect(screen.queryByRole("link", { name: /checkout\.json/ })).not.toBeInTheDocument();
  });

  it("generates a namespace link from a dedicated namespace selector and section", async () => {
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText("bundle-version-123");
    const namespaceSection = screen.getByRole("region", { name: "Namespace endpoint" });
    expect(within(namespaceSection).getByRole("link", { name: /common\.json/ })).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Locale and manifest endpoints" })).queryByRole(
        "link",
        { name: /common\.json/ },
      ),
    ).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Namespace" }), "checkout");

    expect(within(namespaceSection).queryByRole("link", { name: /common\.json/ })).not.toBeInTheDocument();
    expect(within(namespaceSection).getByText("namespace-version-789")).toBeInTheDocument();
    expect(within(namespaceSection).getByRole("link", { name: /checkout\.json/ })).toHaveAttribute(
      "href",
      "http://localhost:3000/static/demo-project/production/en/checkout.json",
    );
  });

  it("explains stable links and optional versions without exposing any configured delivery token", async () => {
    renderPanel();

    await screen.findByText("bundle-version-123");
    expect(screen.getByText(/always resolve to the current translations/)).toBeInTheDocument();
    expect(screen.getByText(/becomes invalid after the translations change/)).toBeInTheDocument();
    expect(screen.getByText(/deployment-wide server setting and is never shown in this UI/)).toBeInTheDocument();
    expect(screen.queryByText(/OXIDERELAY_DELIVERY_TOKEN/)).not.toBeInTheDocument();
  });
});
