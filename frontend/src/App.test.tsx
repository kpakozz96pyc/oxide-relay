import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { TranslationGridRow } from "./api";

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

describe("App routing", () => {
  it("redirects unauthenticated users to login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");

        if (isLocaleRequest(url.pathname)) {
          return jsonResponse({});
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
        const path = `${url.pathname}${url.search}`;

        if (isLocaleRequest(url.pathname)) {
          return jsonResponse({});
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
  });

  it("creates a translation from the project workspace", async () => {
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
          return jsonResponse({});
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
              "ManageProjectMembers",
              "ReadTranslations",
              "ReadProduction",
              "EditProduction",
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

        if (path === "/api/v1/projects/demo-project/translations/grid?environment=production&namespace=common&languages=en&search=&page=1&page_size=25") {
          return jsonResponse({
            items: translationRows,
            total: translationRows.length,
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

          translationRows.push({
            representative_translation_id: "translation-2",
            translation_key_id: "key-2",
            key: body.key,
            description: body.description ?? null,
            namespace: body.namespace,
            values: {
              [body.language]: {
                id: "translation-2",
                value: body.value,
              },
            },
          });

          return jsonResponse(
            {
              id: "translation-2",
              translation_key_id: "key-2",
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

    expect(await screen.findByText("Demo Project")).toBeInTheDocument();
    expect(await screen.findByText("button.save")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("project.table.new_key_placeholder"), "cta.publish");
    await user.type(screen.getAllByPlaceholderText("project.table.description_placeholder")[0], "Publish CTA");
    await user.type(screen.getByPlaceholderText("project.table.value_placeholder (en)"), "Publish");
    await user.click(screen.getByRole("button", { name: "actions.save" }));

    expect(await screen.findByText("cta.publish")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Publish CTA")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Publish")).toBeInTheDocument();
  });

  it("keeps restricted translation actions unavailable for a member without edit permissions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
        const method = init?.method ?? "GET";
        const path = `${url.pathname}${url.search}`;

        if (isLocaleRequest(url.pathname)) {
          return jsonResponse({});
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
            permissions: ["ReadTranslations", "ReadProduction"],
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

        if (path === "/api/v1/projects/demo-project/translations/grid?environment=production&namespace=common&languages=en&search=&page=1&page_size=25") {
          return jsonResponse({
            items: [],
            total: 0,
            page: 1,
            page_size: 25,
          });
        }

        throw new Error(`Unexpected request: ${method} ${path}`);
      }),
    );

    renderApp(["/projects/demo-project"]);

    expect(await screen.findByText("project.badges.member_workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "project.import.button" })).toBeDisabled();
    expect(screen.queryByPlaceholderText("project.table.new_key_placeholder")).not.toBeInTheDocument();
    expect(screen.queryByText("project.members.title")).not.toBeInTheDocument();
  });
});
