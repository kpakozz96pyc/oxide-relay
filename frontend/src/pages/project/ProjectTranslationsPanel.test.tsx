import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("ProjectTranslationsPanel write-control permission gating (OXR-56)", () => {
  function renderPanelWithPermissions(permissions: string[]) {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;

      if (path === "/api/v1/me/permissions") {
        return Promise.resolve(jsonResponse({ permissions }));
      }
      if (path === "/api/v1/projects/demo-project/translations/grid") {
        return Promise.resolve(jsonResponse(gridResponse));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
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

    return { fetchMock };
  }

  it("disables the value and description cells for a read-only member (ReadTranslations only)", async () => {
    renderPanelWithPermissions(["ReadTranslations"]);

    const valueInput = await screen.findByDisplayValue("Save");
    expect(valueInput).toBeDisabled();
    const descriptionInput = screen.getByPlaceholderText("Optional description");
    expect(descriptionInput).toBeDisabled();

    // Without EditTranslations/DeleteTranslations there is nothing to create or delete.
    expect(screen.queryByRole("button", { name: "+" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("translation.key")).not.toBeInTheDocument();
  });

  it("keeps the value cell disabled when EditTranslations is granted without the environment permission", async () => {
    // This is the exact gap the bug report described: a member has EditTranslations but
    // not EditProd for the "production" environment used in these fixtures, so the
    // backend would still reject the write. The cell must stay disabled, not just fail
    // silently after the request.
    renderPanelWithPermissions(["ReadTranslations", "EditTranslations"]);

    const valueInput = await screen.findByDisplayValue("Save");
    expect(valueInput).toBeDisabled();
  });

  it("enables the value and description cells once the caller holds full write permissions", async () => {
    renderPanelWithPermissions([
      "ReadTranslations",
      "EditTranslations",
      "EditProd",
      "DeleteTranslations",
    ]);

    const valueInput = await screen.findByDisplayValue("Save");
    expect(valueInput).not.toBeDisabled();
    const existingRow = valueInput.closest("tr");
    if (!existingRow) {
      throw new Error("expected the translation row to contain the value input");
    }
    const descriptionInput = within(existingRow).getByPlaceholderText("Optional description");
    expect(descriptionInput).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "+" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete/ })).not.toBeDisabled();
  });
});

describe("ProjectTranslationsPanel new-key draft stability (OXR-62)", () => {
  const ownerProject: Project = { ...project, owner_user_id: "owner-1", is_owner: true };
  const twoNamespaces: Namespace[] = [
    ...namespaces,
    {
      id: "namespace-2",
      project_id: project.id,
      name: "other",
      created_at: "2026-08-06T00:00:00Z",
      updated_at: "2026-08-06T00:00:00Z",
    },
  ];
  const emptyGridResponse: TranslationGridResponse = { items: [], total: 0, page: 1, page_size: 25 };

  function renderDraftPanel() {
    const createCalls: unknown[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;

      if (path === "/api/v1/me/permissions") {
        return Promise.resolve(jsonResponse({ permissions: [] }));
      }
      if (path === "/api/v1/projects/demo-project/translations/grid") {
        return Promise.resolve(jsonResponse(emptyGridResponse));
      }
      if (path === "/api/v1/projects/demo-project/translations" && init?.method === "POST") {
        createCalls.push(init.body ? JSON.parse(String(init.body)) : null);
        return Promise.resolve(
          jsonResponse(
            {
              id: "new-value-1",
              translation_key_id: "new-key-1",
              key: "greeting.hello",
              description: null,
              namespace: "common",
              language_code: "en",
              environment_slug: "production",
              value: "Hello",
              updated_by_user_id: null,
              created_at: "2026-08-06T00:00:00Z",
              updated_at: "2026-08-06T00:00:00Z",
            },
            201,
          ),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ProjectTranslationsPanel
            environments={environments}
            languages={languages}
            namespaces={twoNamespaces}
            project={ownerProject}
            projectSlug={ownerProject.slug}
          />
        </I18nProvider>
      </QueryClientProvider>,
    );

    return { fetchMock, createCalls };
  }

  it("does not submit a partial draft when focus moves outside the grid", async () => {
    const user = userEvent.setup();
    const { createCalls } = renderDraftPanel();

    const keyInput = await screen.findByPlaceholderText("translation.key");
    await user.type(keyInput, "greeting.hello");
    const valueInput = screen.getByPlaceholderText("Value (en)");
    await user.type(valueInput, "Hello");

    // Click something entirely outside the grid (the search field), the way clicking
    // the "visible languages" dropdown or any other toolbar control would. userEvent
    // fires a real blur (with relatedTarget set) on the value input first, exercising
    // whatever the grid wires up for "focus left the grid" the same way a browser would.
    await user.click(screen.getByPlaceholderText("Find keys or descriptions"));

    expect(createCalls).toHaveLength(0);
    expect(keyInput).toHaveValue("greeting.hello");
    expect(valueInput).toHaveValue("Hello");
  });

  it("saves a new key only through the explicit Save action, and the Add action stays available", async () => {
    const user = userEvent.setup();
    const { createCalls } = renderDraftPanel();

    const keyInput = await screen.findByPlaceholderText("translation.key");
    await user.type(keyInput, "greeting.hello");
    await user.type(screen.getByPlaceholderText("Value (en)"), "Hello");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createCalls).toEqual([
        expect.objectContaining({ key: "greeting.hello", value: "Hello" }),
      ]);
    });

    // The row-adding affordance (header "+" button) and a fresh empty draft row must
    // both still be present, so a second key can be added right away.
    expect(screen.getByRole("button", { name: "+" })).toBeInTheDocument();
    expect(await screen.findByPlaceholderText("translation.key")).toHaveValue("");
  });

  it("clears an in-progress draft when the namespace changes", async () => {
    renderDraftPanel();

    const keyInput = await screen.findByPlaceholderText("translation.key");
    fireEvent.change(keyInput, { target: { value: "leaked.key" } });
    expect(keyInput).toHaveValue("leaked.key");

    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "other" } });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("translation.key")).toHaveValue("");
    });
  });
});

describe("ProjectTranslationsPanel base/target language clarity (OXR-72)", () => {
  const ownerProject: Project = { ...project, owner_user_id: "owner-1", is_owner: true };
  const threeLanguages: Language[] = [
    { ...languages[0], code: "en", name: "English" },
    { id: "language-2", project_id: project.id, code: "ru", name: "Russian", created_at: "2026-08-06T00:00:00Z", updated_at: "2026-08-06T00:00:00Z" },
    { id: "language-3", project_id: project.id, code: "srb", name: "Serbian", created_at: "2026-08-06T00:00:00Z", updated_at: "2026-08-06T00:00:00Z" },
  ];

  // key.cancel is missing "ru" only; key.save is missing "srb" only.
  function gridFor(missingLanguages: string[]): TranslationGridResponse {
    const wantsRu = missingLanguages.includes("ru");
    const wantsSrb = missingLanguages.includes("srb");
    const items = [];
    if (wantsRu) {
      items.push({
        representative_translation_id: "value-cancel",
        translation_key_id: "key-cancel",
        key: "button.cancel",
        description: null,
        namespace: "common",
        values: { en: { id: "value-cancel", value: "Cancel" } },
      });
    }
    if (wantsSrb) {
      items.push({
        representative_translation_id: "value-save",
        translation_key_id: "key-save",
        key: "button.save",
        description: null,
        namespace: "common",
        values: { en: { id: "value-save", value: "Save" } },
      });
    }
    return { items, total: items.length, page: 1, page_size: 25 };
  }

  function renderMissingModePanel() {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;

      if (path === "/api/v1/me/permissions") {
        return Promise.resolve(jsonResponse({ permissions: [] }));
      }
      if (path === "/api/v1/projects/demo-project/translations/grid") {
        const missingLanguages = (url.searchParams.get("missing_languages") ?? "").split(",").filter(Boolean);
        return Promise.resolve(jsonResponse(gridFor(missingLanguages)));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ProjectTranslationsPanel
            environments={environments}
            languages={threeLanguages}
            namespaces={namespaces}
            project={ownerProject}
            projectSlug={ownerProject.slug}
          />
        </I18nProvider>
      </QueryClientProvider>,
    );

    return { fetchMock };
  }

  async function switchToMissingMode(user: ReturnType<typeof userEvent.setup>) {
    await user.selectOptions(screen.getByLabelText("View"), "missing");
  }

  it("does not list the base language as a target option", async () => {
    const user = userEvent.setup();
    renderMissingModePanel();
    await switchToMissingMode(user);

    await user.click(screen.getByRole("button", { name: /ru/ }));

    expect(screen.queryByText("en · English", { selector: ".dropdown-option span" })).not.toBeInTheDocument();
    expect(screen.getByText("ru · Russian", { selector: ".dropdown-option span" })).toBeInTheDocument();
    expect(screen.getByText("srb · Serbian", { selector: ".dropdown-option span" })).toBeInTheDocument();
  });

  it("focusing a target language narrows the grid without discarding the other selected targets", async () => {
    const user = userEvent.setup();
    renderMissingModePanel();
    await switchToMissingMode(user);

    // select both "ru" and "srb" as targets
    await user.click(screen.getByRole("button", { name: /ru/ }));
    await user.click(screen.getByLabelText("srb · Serbian"));
    await user.click(screen.getByRole("button", { name: /ru/ })); // close the dropdown

    expect(await screen.findByText("button.cancel")).toBeInTheDocument();
    expect(screen.getByText("button.save")).toBeInTheDocument();

    // focus the "ru" column
    const ruHeader = screen.getByRole("columnheader", { name: /^ru/ });
    await user.click(within(ruHeader).getByRole("button", { name: "Focus" }));

    await waitFor(() => {
      expect(screen.queryByText("button.save")).not.toBeInTheDocument();
    });
    expect(screen.getByText("button.cancel")).toBeInTheDocument();

    // both targets must still be selected underneath the focus
    await user.click(screen.getByRole("button", { name: /ru/ }));
    expect(screen.getByLabelText("ru · Russian")).toBeChecked();
    expect(screen.getByLabelText("srb · Serbian")).toBeChecked();
    await user.click(screen.getByRole("button", { name: /ru/ }));

    // clearing focus restores both rows
    await user.click(screen.getByRole("button", { name: "Clear focus" }));
    await waitFor(() => {
      expect(screen.getByText("button.save")).toBeInTheDocument();
    });
    expect(screen.getByText("button.cancel")).toBeInTheDocument();
  });
});
