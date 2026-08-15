import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Environment, Language, Namespace, Project, TranslationGridResponse } from "../../api";
import { I18nProvider } from "../../i18n";
import { ProjectTranslationsPanel } from "./ProjectTranslationsPanel";

const project: Project = {
  id: "project-1",
  name: "Demo Project",
  slug: "demo-project",
  description: null,
  owner_user_id: "someone-else",
  created_at: "2026-08-06T00:00:00Z",
  updated_at: "2026-08-06T00:00:00Z",
  is_owner: false,
};

const languages: Language[] = [
  {
    id: "language-1",
    project_id: project.id,
    code: "en",
    name: "English",
    created_at: "2026-08-06T00:00:00Z",
    updated_at: "2026-08-06T00:00:00Z",
  },
];

const namespaces: Namespace[] = [
  {
    id: "namespace-1",
    project_id: project.id,
    name: "common",
    created_at: "2026-08-06T00:00:00Z",
    updated_at: "2026-08-06T00:00:00Z",
  },
];

const environments: Environment[] = [
  {
    id: "environment-1",
    project_id: project.id,
    name: "Production",
    slug: "production",
    created_at: "2026-08-06T00:00:00Z",
    updated_at: "2026-08-06T00:00:00Z",
  },
];

const gridResponse: TranslationGridResponse = {
  items: [
    {
      representative_translation_id: "value-1",
      translation_key_id: "key-1",
      key: "button.save",
      description: null,
      namespace: "common",
      values: { en: { id: "value-1", value: "Save" } },
    },
  ],
  total: 1,
  page: 1,
  page_size: 25,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPanel(hasReadTranslations: () => boolean) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;

    if (path === "/api/v1/me/permissions") {
      return Promise.resolve(
        jsonResponse({ permissions: hasReadTranslations() ? ["ReadTranslations"] : [] }),
      );
    }
    if (path === "/api/v1/projects/demo-project/translations/grid") {
      return Promise.resolve(jsonResponse(gridResponse));
    }
    // i18n delivery-metadata / static namespace lookups: not under test, fail closed
    // into the provider's own catch handling so it falls back to bundled messages.
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ProjectTranslationsPanel
          environments={environments}
          languages={languages}
          namespaces={namespaces}
          project={project}
          projectSlug={project.slug}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );

  return { ...view, fetchMock, queryClient };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProjectTranslationsPanel permission gating (OXR-55)", () => {
  it("renders translation values once the caller holds ReadTranslations", async () => {
    renderPanel(() => true);

    expect(await screen.findByDisplayValue("Save")).toBeInTheDocument();
    expect(
      screen.queryByText("You do not have permission to view translations for this environment."),
    ).not.toBeInTheDocument();
  });

  it("never fetches or renders translation values without ReadTranslations", async () => {
    const { fetchMock } = renderPanel(() => false);

    expect(
      await screen.findByText("You do not have permission to view translations for this environment."),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Save")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input]) =>
            new URL(String(input), "http://localhost").pathname ===
            "/api/v1/projects/demo-project/translations/grid",
        ),
      ).toBe(false);
    });
  });

  it("stops rendering already-fetched translation values once ReadTranslations is revoked", async () => {
    let hasReadTranslations = true;
    const { queryClient } = renderPanel(() => hasReadTranslations);

    expect(await screen.findByDisplayValue("Save")).toBeInTheDocument();

    // Simulate an admin revoking ReadTranslations mid-session: the permission set
    // refetches and flips to false, but the already-loaded grid `data` is still
    // cached by react-query. The panel must stop rendering it immediately instead
    // of leaving stale protected values on screen next to the denial banner.
    hasReadTranslations = false;
    await queryClient.invalidateQueries({ queryKey: ["current-permissions"] });

    await waitFor(() => {
      expect(
        screen.getByText("You do not have permission to view translations for this environment."),
      ).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("Save")).not.toBeInTheDocument();
  });
});
