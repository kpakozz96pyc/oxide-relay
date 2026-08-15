import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { Project, TranslationGridRow } from "./api";

function renderApp(initialEntries: string[]) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function unauthorizedResponse() {
  return new Response(
    JSON.stringify({
      error: {
        code: "Unauthorized",
        message: "Authentication is required.",
      },
    }),
    {
      status: 401,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function isLocaleRequest(pathname: string) {
  return pathname.startsWith("/static/oxide-relay/production/") && pathname.endsWith("/common.json");
}

function isMetadataRequest(pathname: string) {
  return pathname === "/api/v1/projects/oxide-relay/delivery-metadata";
}

const TEST_LOCALE_MESSAGES = {
  "login.form.title": "login.form.title",
  "projects.title": "projects.title",
  "projects.visible_suffix": "projects.visible_suffix",
  "project.table.new_key_placeholder": "project.table.new_key_placeholder",
  "project.table.description_placeholder": "project.table.description_placeholder",
  "project.table.value_placeholder": "project.table.value_placeholder",
  "actions.save": "actions.save",
  "project.badges.member_workspace": "project.badges.member_workspace",
  "project.import.button": "project.import.button",
  "project.members.title": "project.members.title",
  "users.title": "users.title",
  "users.reset_link.generate": "users.reset_link.generate",
  "users.reset_link.generated_title": "users.reset_link.generated_title",
  "users.permissions.selected_user": "users.permissions.selected_user",
  "reset_password.form.title": "reset_password.form.title",
  "reset_password.password": "reset_password.password",
  "reset_password.confirm_password": "reset_password.confirm_password",
  "reset_password.submit": "reset_password.submit",
  "reset_password.success": "reset_password.success",
} as const;

describe("App routing", () => {
  it("redirects unauthenticated users to login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");

        if (isLocaleRequest(url.pathname)) {
          return jsonResponse(TEST_LOCALE_MESSAGES);
        }

        if (isMetadataRequest(url.pathname)) {
          return jsonResponse({
            version: "v1",
            languages: [{ code: "en", name: "English" }],
            namespaces: [{ name: "common" }],
          });
        }

        if (url.pathname === "/api/v1/me") {
          return unauthorizedResponse();
        }

        throw new Error(`Unexpected request: ${url.pathname}${url.search}`);
      }),
    );

    renderApp(["/projects"]);

    expect(await screen.findByText("login.form.title")).toBeInTheDocument();
  });

  it("renders the projects workspace for an authenticated user", async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
        const path = `${url.pathname}${url.search}`;

        if (isLocaleRequest(url.pathname)) {
          return jsonResponse(TEST_LOCALE_MESSAGES);
        }

        if (isMetadataRequest(url.pathname)) {
          return jsonResponse({
            version: "v1",
            languages: [{ code: "en", name: "English" }],
            namespaces: [{ name: "common" }],
          });
        }

        if (path === "/api/v1/me") {
          return jsonResponse({
            user: {
              id: "user-1",
              email: "admin@example.com",
              display_name: "Administrator",
            },
          });
        }

        if (path === "/api/v1/me/permissions") {
          return jsonResponse({ permissions: ["CreateProjects"] });
        }

        if (path === "/api/v1/projects") {
          return jsonResponse([]);
        }

        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    renderApp(["/projects"]);

    expect(await screen.findByText("projects.title")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("0 projects.visible_suffix")).toBeInTheDocument();
    });

    expect(screen.getByText("No projects are available.")).toBeInTheDocument();
    const emptyStateCreateButton = within(screen.getByText("No projects are available.").parentElement as HTMLElement).getByRole(
      "button",
      { name: "New project" },
    );
    await user.click(emptyStateCreateButton);
    expect(await screen.findByRole("heading", { name: "New project" })).toBeInTheDocument();
  });

  it("renders project settings tabs and updates project settings", async () => {
    const user = userEvent.setup();
    let currentProject: Project = {
      id: "project-1",
      name: "Demo Project",
      slug: "demo-project",
      description: "Project for UI tests",
      owner_user_id: "user-1",
      created_at: "2026-06-19T00:00:00Z",
      updated_at: "2026-06-19T00:00:00Z",
      is_owner: true,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
        const method = init?.method ?? "GET";
        const path = `${url.pathname}${url.search}`;

        if (isLocaleRequest(url.pathname)) {
          return jsonResponse(TEST_LOCALE_MESSAGES);
        }

        if (isMetadataRequest(url.pathname)) {
          return jsonResponse({
            version: "v1",
            languages: [{ code: "en", name: "English" }],
            namespaces: [{ name: "common" }],
          });
        }

        if (path === "/api/v1/me") {
          return jsonResponse({
            user: {
              id: "user-1",
              email: "admin@example.com",
              display_name: "Administrator",
            },
          });
        }

        if (path === "/api/v1/me/permissions") {
          return jsonResponse({
            permissions: [
              "EditProjects",
              "ManageProjectMembers",
            ],
          });
        }

        if (path === "/api/v1/projects/demo-project") {
          return jsonResponse(currentProject);
        }

        if (path === "/api/v1/projects/demo-project/languages") {
          return jsonResponse([
            {
              id: "language-1",
              project_id: "project-1",
              code: "en",
              name: "English",
              created_at: "2026-06-19T00:00:00Z",
              updated_at: "2026-06-19T00:00:00Z",
            },
          ]);
        }

        if (path === "/api/v1/projects/demo-project/namespaces") {
          return jsonResponse([
            {
              id: "namespace-1",
              project_id: "project-1",
              name: "common",
              created_at: "2026-06-19T00:00:00Z",
              updated_at: "2026-06-19T00:00:00Z",
            },
          ]);
        }

        if (path === "/api/v1/projects/demo-project/environments") {
          return jsonResponse([
            {
              id: "environment-1",
              project_id: "project-1",
              name: "Production",
              slug: "production",
              created_at: "2026-06-19T00:00:00Z",
              updated_at: "2026-06-19T00:00:00Z",
            },
          ]);
        }

        if (path === "/api/v1/projects/demo-project/members") {
          return jsonResponse([
            {
              id: "user-1",
              email: "admin@example.com",
              display_name: "Administrator",
              is_active: true,
              is_owner: true,
              added_at: "2026-06-19T00:00:00Z",
            },
          ]);
        }

        if (path === "/api/v1/projects/demo-project/delivery-manifest/en?environment=production") {
          return jsonResponse({
            project: "demo-project",
            locale: "en",
            environment: "production",
            locale_bundle_version: "v1",
            locale_bundle_url: "/api/v1/projects/demo-project/locales/en?environment=production",
            namespaces: [
              {
                name: "common",
                version: "v1",
                url: "/api/v1/projects/demo-project/locales/en/common?environment=production",
              },
            ],
          });
        }

        if (url.pathname === "/api/v1/projects/demo-project" && method === "PUT") {
          const body = JSON.parse(String(init?.body)) as {
            name: string;
            slug: string;
            description?: string;
          };

          currentProject = {
            ...currentProject,
            name: body.name,
            slug: body.slug,
            description: body.description ?? null,
            updated_at: "2026-06-19T01:00:00Z",
          };
          return jsonResponse(currentProject);
        }

        throw new Error(`Unexpected request: ${method} ${path}`);
      }),
    );

    renderApp(["/projects/demo-project"]);

    expect(await screen.findByRole("heading", { name: "Demo Project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Access" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Danger Zone" })).toBeInTheDocument();
    expect(screen.getByText("Changing the slug may break existing delivery URLs.")).toBeInTheDocument();

    const saveButton = screen.getByRole("button", { name: "Save changes" });
    expect(saveButton).toBeDisabled();

    await user.clear(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), "Relay Console");
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);

    expect(await screen.findByText("Project settings saved.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Relay Console")).toBeInTheDocument();
  });

  it("creates a translation from the translations tab", async () => {
    const user = userEvent.setup();
    const translationRows: TranslationGridRow[] = [
      {
        representative_translation_id: "translation-1",
        translation_key_id: "key-1",
        key: "button.save",
        description: "Initial value",
        namespace: "common",
        values: {
          en: {
            id: "translation-1",
            value: "Save",
          },
        },
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
        const method = init?.method ?? "GET";
        const path = `${url.pathname}${url.search}`;

        if (isLocaleRequest(url.pathname)) {
          return jsonResponse(TEST_LOCALE_MESSAGES);
        }

        if (isMetadataRequest(url.pathname)) {
          return jsonResponse({
            version: "v1",
            languages: [{ code: "en", name: "English" }],
            namespaces: [{ name: "common" }],
          });
        }

        if (path === "/api/v1/me") {
          return jsonResponse({
            user: {
              id: "user-1",
              email: "admin@example.com",
              display_name: "Administrator",
            },
          });
        }

        if (path === "/api/v1/me/permissions") {
          return jsonResponse({
            permissions: [
              "EditProjects",
              "EditTranslations",
              "DeleteTranslations",
              "ImportTranslations",
              "ReadTranslations",
              "EditProd",
            ],
          });
        }

        if (path === "/api/v1/projects/demo-project") {
          return jsonResponse({
            id: "project-1",
            name: "Demo Project",
            slug: "demo-project",
            description: "Project for UI tests",
            owner_user_id: "user-1",
            created_at: "2026-06-19T00:00:00Z",
            updated_at: "2026-06-19T00:00:00Z",
            is_owner: true,
          });
        }

        if (path === "/api/v1/projects/demo-project/languages") {
          return jsonResponse([
            {
              id: "language-1",
              project_id: "project-1",
              code: "en",
              name: "English",
              created_at: "2026-06-19T00:00:00Z",
              updated_at: "2026-06-19T00:00:00Z",
            },
            {
              id: "language-2",
              project_id: "project-1",
              code: "ru",
              name: "Russian",
              created_at: "2026-06-19T00:00:00Z",
              updated_at: "2026-06-19T00:00:00Z",
            },
          ]);
        }

        if (path === "/api/v1/projects/demo-project/namespaces") {
          return jsonResponse([
            {
              id: "namespace-1",
              project_id: "project-1",
              name: "common",
              created_at: "2026-06-19T00:00:00Z",
              updated_at: "2026-06-19T00:00:00Z",
            },
          ]);
        }

        if (path === "/api/v1/projects/demo-project/environments") {
          return jsonResponse([
            {
              id: "environment-1",
              project_id: "project-1",
              name: "Production",
              slug: "production",
              created_at: "2026-06-19T00:00:00Z",
              updated_at: "2026-06-19T00:00:00Z",
            },
          ]);
        }

        if (
          path ===
          "/api/v1/projects/demo-project/translations/grid?environment=production&namespace=common&languages=en&search=&page=1&page_size=25"
        ) {
          return jsonResponse({
            items: translationRows,
            total: translationRows.length,
            page: 1,
            page_size: 25,
          });
        }

        if (
          path ===
          "/api/v1/projects/demo-project/translations/grid?environment=production&namespace=common&languages=en%2Cru&search=&page=1&page_size=25&base_language=en&missing_languages=ru"
        ) {
          const missingRows = translationRows.filter((row) => !row.values.ru?.id);
          return jsonResponse({
            items: missingRows,
            total: missingRows.length,
            page: 1,
            page_size: 25,
          });
        }

        if (url.pathname === "/api/v1/projects/demo-project/translations" && method === "POST") {
          const body = JSON.parse(String(init?.body)) as {
            key: string;
            description?: string;
            namespace: string;
            language: string;
            environment: string;
            value: string;
          };

          const existingRow = translationRows.find((row) => row.key === body.key);
          const translationId = `translation-${translationRows.length + 1}-${body.language}`;
          if (existingRow) {
            existingRow.values[body.language] = {
              id: translationId,
              value: body.value,
            };
          } else {
            translationRows.push({
              representative_translation_id: translationId,
              translation_key_id: `key-${translationRows.length + 1}`,
              key: body.key,
              description: body.description ?? null,
              namespace: body.namespace,
              values: {
                [body.language]: {
                  id: translationId,
                  value: body.value,
                },
              },
            });
          }

          return jsonResponse(
            {
              id: translationId,
              translation_key_id: existingRow?.translation_key_id ?? `key-${translationRows.length}`,
              key: body.key,
              description: body.description ?? null,
              namespace: body.namespace,
              language_code: body.language,
              environment_slug: body.environment,
              value: body.value,
              updated_by_user_id: "user-1",
              created_at: "2026-06-19T00:01:00Z",
              updated_at: "2026-06-19T00:01:00Z",
            },
            201,
          );
        }

        throw new Error(`Unexpected request: ${method} ${path}`);
      }),
    );

    renderApp(["/projects/demo-project"]);

    await user.click(await screen.findByRole("button", { name: "Translations" }));
    expect(await screen.findByText("button.save")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("project.table.new_key_placeholder"), "cta.publish");
    await user.type(screen.getAllByPlaceholderText("project.table.description_placeholder")[0], "Publish CTA");
    await user.type(screen.getByPlaceholderText("project.table.value_placeholder (en)"), "Publish");
    await user.click(screen.getByRole("button", { name: "actions.save" }));

    expect(await screen.findByText("cta.publish")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Publish CTA")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Publish")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("View"), "missing");
    const [missingInput] = await screen.findAllByPlaceholderText("Add value for ru");
    await user.type(missingInput, "Сохранить{enter}");

    await waitFor(() => {
      expect(screen.queryByDisplayValue("Сохранить")).not.toBeInTheDocument();
    });
  });

  it("shows next-action CTAs for empty resource and translation states", async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
        const method = init?.method ?? "GET";
        const path = `${url.pathname}${url.search}`;

        if (isLocaleRequest(url.pathname)) {
          return jsonResponse(TEST_LOCALE_MESSAGES);
        }

        if (isMetadataRequest(url.pathname)) {
          return jsonResponse({
            version: "v1",
            languages: [{ code: "en", name: "English" }],
            namespaces: [{ name: "common" }],
          });
        }

        if (path === "/api/v1/me") {
          return jsonResponse({
            user: { id: "user-1", email: "admin@example.com", display_name: "Administrator" },
          });
        }

        if (path === "/api/v1/me/permissions") {
          return jsonResponse({ permissions: [] });
        }

        if (path === "/api/v1/projects/demo-project") {
          return jsonResponse({
            id: "project-1",
            name: "Demo Project",
            slug: "demo-project",
            description: "Project for UI tests",
            owner_user_id: "user-1",
            created_at: "2026-06-19T00:00:00Z",
            updated_at: "2026-06-19T00:00:00Z",
            is_owner: true,
          });
        }

        if (path === "/api/v1/projects/demo-project/languages") {
          return jsonResponse([]);
        }

        if (path === "/api/v1/projects/demo-project/namespaces") {
          return jsonResponse([]);
        }

        if (path === "/api/v1/projects/demo-project/environments") {
          return jsonResponse([
            {
              id: "environment-1",
              project_id: "project-1",
              name: "Production",
              slug: "production",
              created_at: "2026-06-19T00:00:00Z",
              updated_at: "2026-06-19T00:00:00Z",
            },
          ]);
        }

        throw new Error(`Unexpected request: ${method} ${path}`);
      }),
    );

    renderApp(["/projects/demo-project"]);

    await user.click(await screen.findByRole("button", { name: "Languages" }));
    expect(await screen.findByText("Nothing to show yet.")).toBeInTheDocument();
    const newLanguageButtons = screen.getAllByRole("button", { name: "New language" });
    await user.click(newLanguageButtons[newLanguageButtons.length - 1]);
    expect(await screen.findByRole("heading", { name: "New language" })).toBeInTheDocument();
    await user.click(screen.getByLabelText("Close create language dialog"));

    await user.click(screen.getByRole("button", { name: "Namespaces" }));
    expect(await screen.findByText("Nothing to show yet.")).toBeInTheDocument();
    const newNamespaceButtons = screen.getAllByRole("button", { name: "New namespace" });
    await user.click(newNamespaceButtons[newNamespaceButtons.length - 1]);
    expect(await screen.findByRole("heading", { name: "New namespace" })).toBeInTheDocument();
  });

  it("focuses the new key input from the empty translations state action", async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
        const method = init?.method ?? "GET";
        const path = `${url.pathname}${url.search}`;

        if (isLocaleRequest(url.pathname)) {
          return jsonResponse(TEST_LOCALE_MESSAGES);
        }

        if (isMetadataRequest(url.pathname)) {
          return jsonResponse({
            version: "v1",
            languages: [{ code: "en", name: "English" }],
            namespaces: [{ name: "common" }],
          });
        }

        if (path === "/api/v1/me") {
          return jsonResponse({
            user: { id: "user-1", email: "admin@example.com", display_name: "Administrator" },
          });
        }

        if (path === "/api/v1/me/permissions") {
          return jsonResponse({ permissions: [] });
        }

        if (path === "/api/v1/projects/demo-project") {
          return jsonResponse({
            id: "project-1",
            name: "Demo Project",
            slug: "demo-project",
            description: "Project for UI tests",
            owner_user_id: "user-1",
            created_at: "2026-06-19T00:00:00Z",
            updated_at: "2026-06-19T00:00:00Z",
            is_owner: true,
          });
        }

        if (path === "/api/v1/projects/demo-project/languages") {
          return jsonResponse([
            {
              id: "language-1",
              project_id: "project-1",
              code: "en",
              name: "English",
              created_at: "2026-06-19T00:00:00Z",
              updated_at: "2026-06-19T00:00:00Z",
            },
          ]);
        }

        if (path === "/api/v1/projects/demo-project/namespaces") {
          return jsonResponse([
            {
              id: "namespace-1",
              project_id: "project-1",
              name: "common",
              created_at: "2026-06-19T00:00:00Z",
              updated_at: "2026-06-19T00:00:00Z",
            },
          ]);
        }

        if (path === "/api/v1/projects/demo-project/environments") {
          return jsonResponse([
            {
              id: "environment-1",
              project_id: "project-1",
              name: "Production",
              slug: "production",
              created_at: "2026-06-19T00:00:00Z",
              updated_at: "2026-06-19T00:00:00Z",
            },
          ]);
        }

        if (
          path ===
          "/api/v1/projects/demo-project/translations/grid?environment=production&namespace=common&languages=en&search=&page=1&page_size=25"
        ) {
          return jsonResponse({ items: [], total: 0, page: 1, page_size: 25 });
        }

        throw new Error(`Unexpected request: ${method} ${path}`);
      }),
    );

    renderApp(["/projects/demo-project"]);

    await user.click(await screen.findByRole("button", { name: "Translations" }));

    expect(await screen.findByText("No translations match the current filters.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add your first translation key" }));

    expect(screen.getByPlaceholderText("project.table.new_key_placeholder")).toHaveFocus();
  });

  it("keeps project settings read-only for a member without edit permissions", async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
        const method = init?.method ?? "GET";
        const path = `${url.pathname}${url.search}`;

        if (isLocaleRequest(url.pathname)) {
          return jsonResponse(TEST_LOCALE_MESSAGES);
        }

        if (isMetadataRequest(url.pathname)) {
          return jsonResponse({
            version: "v1",
            languages: [{ code: "en", name: "English" }],
            namespaces: [{ name: "common" }],
          });
        }

        if (path === "/api/v1/me") {
          return jsonResponse({
            user: {
              id: "user-2",
              email: "member@example.com",
              display_name: "Member",
            },
          });
        }

        if (path === "/api/v1/me/permissions") {
          return jsonResponse({
            permissions: [],
          });
        }

        if (path === "/api/v1/projects/demo-project") {
          return jsonResponse({
            id: "project-1",
            name: "Demo Project",
            slug: "demo-project",
            description: "Project for permission tests",
            owner_user_id: "owner-1",
            created_at: "2026-06-19T00:00:00Z",
            updated_at: "2026-06-19T00:00:00Z",
            is_owner: false,
          });
        }

        if (path === "/api/v1/projects/demo-project/languages") {
          return jsonResponse([
            {
              id: "language-1",
              project_id: "project-1",
              code: "en",
              name: "English",
              created_at: "2026-06-19T00:00:00Z",
              updated_at: "2026-06-19T00:00:00Z",
            },
          ]);
        }

        if (path === "/api/v1/projects/demo-project/namespaces") {
          return jsonResponse([
            {
              id: "namespace-1",
              project_id: "project-1",
              name: "common",
              created_at: "2026-06-19T00:00:00Z",
              updated_at: "2026-06-19T00:00:00Z",
            },
          ]);
        }

        if (path === "/api/v1/projects/demo-project/environments") {
          return jsonResponse([
            {
              id: "environment-1",
              project_id: "project-1",
              name: "Production",
              slug: "production",
              created_at: "2026-06-19T00:00:00Z",
              updated_at: "2026-06-19T00:00:00Z",
            },
          ]);
        }

        if (path === "/api/v1/projects/demo-project/delivery-manifest/en?environment=production") {
          return jsonResponse({
            project: "demo-project",
            locale: "en",
            environment: "production",
            locale_bundle_version: "v1",
            locale_bundle_url: "/api/v1/projects/demo-project/locales/en?environment=production",
            namespaces: [],
          });
        }

        throw new Error(`Unexpected request: ${method} ${path}`);
      }),
    );

    renderApp(["/projects/demo-project"]);

    expect(await screen.findByText("Member workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Access" }));

    expect(
      await screen.findByText(/Member management is only visible to the project owner/)
    ).toBeInTheDocument();
    expect(screen.queryByText("Project Members")).not.toBeInTheDocument();
  });

  it("supports the user management workspace workflows", async () => {
    const user = userEvent.setup();
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
      const method = init?.method ?? "GET";
      const path = `${url.pathname}${url.search}`;

        if (isLocaleRequest(url.pathname)) {
          return jsonResponse(TEST_LOCALE_MESSAGES);
        }

        if (isMetadataRequest(url.pathname)) {
          return jsonResponse({
            version: "v1",
            languages: [{ code: "en", name: "English" }],
            namespaces: [{ name: "common" }],
          });
        }

        if (path === "/api/v1/me") {
          return jsonResponse({
            user: {
              id: "user-1",
              email: "admin@example.com",
              display_name: "Administrator",
            },
          });
        }

        if (path === "/api/v1/me/permissions") {
          return jsonResponse({
            permissions: ["ManageUsers", "ManagePermissions"],
          });
        }

        if (url.pathname === "/api/v1/users/summary") {
          return jsonResponse([
            {
              id: "user-1",
              email: "admin@example.com",
              display_name: "Administrator",
              is_active: true,
              created_at: "2026-06-19T00:00:00Z",
              updated_at: "2026-06-19T00:00:00Z",
              direct_permissions_count: 2,
              project_access_count: 1,
              selected_project_relation: null,
            },
            {
              id: "user-2",
              email: "member@example.com",
              display_name: "Member",
              is_active: true,
              created_at: "2026-06-19T00:00:00Z",
              updated_at: "2026-06-19T00:00:00Z",
              direct_permissions_count: 0,
              project_access_count: 0,
              selected_project_relation: null,
            },
          ]);
        }

        if (path === "/api/v1/permissions") {
          return jsonResponse([
            { id: "permission-1", code: "ManageUsers", description: "Manage users" },
            { id: "permission-2", code: "CreateProjects", description: "Create projects" },
            { id: "permission-3", code: "EditAll", description: "Edit non-production environments" },
          ]);
        }

        if (path === "/api/v1/users/user-1/permissions") {
          return jsonResponse([
            { id: "permission-1", code: "ManageUsers", description: "Manage users" },
            { id: "permission-2", code: "CreateProjects", description: "Create projects" },
          ]);
        }

        if (path === "/api/v1/users/user-2/permissions") {
          return jsonResponse([]);
        }

        if (path === "/api/v1/projects/catalog") {
          return jsonResponse([
            {
              id: "project-1",
              name: "Website",
              slug: "website",
              owner_user_id: "user-1",
            },
            {
              id: "project-2",
              name: "Mobile",
              slug: "mobile",
              owner_user_id: "user-2",
            },
            {
              id: "project-3",
              name: "Internal tools",
              slug: "internal-tools",
              owner_user_id: "user-2",
            },
          ]);
        }

        if (path === "/api/v1/users/user-1/project-access") {
          return jsonResponse([
            {
              project_id: "project-1",
              project_name: "Website",
              project_slug: "website",
              owner_user_id: "user-1",
              relation: "owner",
              access_added_at: null,
              can_manage_access: true,
            },
            {
              project_id: "project-2",
              project_name: "Mobile",
              project_slug: "mobile",
              owner_user_id: "user-2",
              relation: "member",
              access_added_at: "2026-06-20T00:00:00Z",
              can_manage_access: true,
            },
            {
              project_id: "project-3",
              project_name: "Internal tools",
              project_slug: "internal-tools",
              owner_user_id: "user-2",
              relation: "none",
              access_added_at: null,
              can_manage_access: true,
            },
          ]);
        }

        if (path === "/api/v1/users/user-2/project-access") {
          return jsonResponse([
            {
              project_id: "project-1",
              project_name: "Website",
              project_slug: "website",
              owner_user_id: "user-1",
              relation: "none",
              access_added_at: null,
              can_manage_access: true,
            },
          ]);
        }

        if (path === "/api/v1/users/user-1/password-reset-link" && method === "POST") {
          return jsonResponse({
            reset_url: "/reset-password?token=one-time-token",
            expires_at: "2026-06-30T12:34:56Z",
          });
        }

        if (path === "/api/v1/users/user-1" && method === "PUT") {
          return jsonResponse({
            id: "user-1",
            email: "admin@example.com",
            display_name: "Administrator",
            is_active: false,
            created_at: "2026-06-19T00:00:00Z",
            updated_at: "2026-06-30T12:35:00Z",
          });
        }

        throw new Error(`Unexpected request: ${method} ${path}`);
      });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(["/users"]);

    expect(await screen.findByRole("heading", { name: "Users and permissions" })).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Search users" }), "member");
    await user.selectOptions(screen.getByRole("combobox", { name: "Project" }), "website");
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "inactive");
    await user.selectOptions(screen.getByRole("combobox", { name: "Permission" }), "ManageUsers");
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes(
            "/api/v1/users/summary?search=member&status=inactive&permission=ManageUsers&project=website",
          ),
        ),
      ).toBe(true);
    });
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("textbox", { name: "Search users" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveValue("all");
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("all");
    expect(screen.getByRole("combobox", { name: "Permission" })).toHaveValue("all");

    await user.click(screen.getByRole("button", { name: "Project access" }));
    expect(await screen.findByText("Owner", { selector: ".relation-badge" })).toBeInTheDocument();
    expect(screen.getByText("Member", { selector: ".relation-badge" })).toBeInTheDocument();
    expect(screen.getByText("No access", { selector: ".relation-badge" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Permissions" }));
    expect(await screen.findByRole("heading", { name: "User management" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Environments" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Security" }));
    // OXR-63 regression: opening a user's Security tab must not narrow the shared
    // users-summary list down to just the selected user. "Member" only appears as a
    // table row (the selected user's own name is also shown in the panel header), so
    // this is unambiguous.
    expect(screen.getByText("Member")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Generate reset link" }));

    expect(await screen.findByText("One-time reset link")).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
    expect(screen.getByText("/reset-password?token=one-time-token")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(clipboardWriteText).toHaveBeenCalledWith("/reset-password?token=one-time-token");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Profile" }));
    await user.click(screen.getByRole("checkbox", { name: "User is active" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(confirmSpy).toHaveBeenCalledWith(
      'Deactivate user "Administrator"? They will no longer be able to sign in.',
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true);
    });

    await user.click(screen.getByText("Member"));

    await waitFor(() => {
      expect(screen.queryByText("/reset-password?token=one-time-token")).not.toBeInTheDocument();
    });
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("shows a clear-filters action in the empty users list state", async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
        const path = url.pathname;

        if (isLocaleRequest(url.pathname)) {
          return jsonResponse(TEST_LOCALE_MESSAGES);
        }

        if (isMetadataRequest(url.pathname)) {
          return jsonResponse({
            version: "v1",
            languages: [{ code: "en", name: "English" }],
            namespaces: [{ name: "common" }],
          });
        }

        if (path === "/api/v1/me") {
          return jsonResponse({
            user: { id: "user-1", email: "admin@example.com", display_name: "Administrator" },
          });
        }

        if (path === "/api/v1/me/permissions") {
          return jsonResponse({ permissions: ["ManageUsers"] });
        }

        if (path === "/api/v1/projects/catalog") {
          return jsonResponse([]);
        }

        if (path === "/api/v1/users/summary") {
          const search = url.searchParams.get("search") ?? "";
          const matches = search === "" || "administrator".includes(search) || "admin@example.com".includes(search);
          return jsonResponse(
            matches
              ? [
                  {
                    id: "user-1",
                    email: "admin@example.com",
                    display_name: "Administrator",
                    is_active: true,
                    created_at: "2026-06-19T00:00:00Z",
                    updated_at: "2026-06-19T00:00:00Z",
                    direct_permissions_count: 1,
                    project_access_count: 0,
                    selected_project_relation: null,
                  },
                ]
              : [],
          );
        }

        if (path.startsWith("/api/v1/users/") && path.endsWith("/project-access")) {
          return jsonResponse([]);
        }

        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    renderApp(["/users"]);

    expect(await screen.findByRole("heading", { name: "Users and permissions" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Administrator/ })).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Search users" }), "nomatch");

    expect(await screen.findByText("No users match the current filters.")).toBeInTheDocument();
    const emptyStateClearButton = within(
      screen.getByText("No users match the current filters.").parentElement as HTMLElement,
    ).getByRole("button", { name: "Clear filters" });

    await user.click(emptyStateClearButton);

    expect(screen.getByRole("textbox", { name: "Search users" })).toHaveValue("");
    expect(await screen.findByRole("row", { name: /Administrator/ })).toBeInTheDocument();
  });

  it("submits a reset password token from the public page", async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
        const method = init?.method ?? "GET";
        const path = `${url.pathname}${url.search}`;

        if (isLocaleRequest(url.pathname)) {
          return jsonResponse(TEST_LOCALE_MESSAGES);
        }

        if (isMetadataRequest(url.pathname)) {
          return jsonResponse({
            version: "v1",
            languages: [{ code: "en", name: "English" }],
            namespaces: [{ name: "common" }],
          });
        }

        if (path === "/api/v1/auth/reset-password" && method === "POST") {
          return new Response(null, { status: 204 });
        }

        if (path === "/api/v1/me") {
          return unauthorizedResponse();
        }

        throw new Error(`Unexpected request: ${method} ${path}`);
      }),
    );

    renderApp(["/reset-password?token=valid-token"]);

    expect(await screen.findByText("reset_password.form.title")).toBeInTheDocument();

    const passwordInputs = screen.getAllByLabelText(/reset_password\.(password|confirm_password)/);
    await user.type(passwordInputs[0], "new-password-1");
    await user.type(passwordInputs[1], "new-password-1");
    await user.click(screen.getByRole("button", { name: "reset_password.submit" }));

    expect(await screen.findByText("reset_password.success")).toBeInTheDocument();
  });
});
