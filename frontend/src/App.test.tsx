import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

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

describe("App routing", () => {
  it("redirects unauthenticated users to login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
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
        ),
      ),
    );

    renderApp(["/projects"]);

    expect(await screen.findByText("Sign in to manage translations.")).toBeInTheDocument();
  });

  it("renders the projects workspace for an authenticated user", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url === "/api/v1/me") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                user: {
                  id: "user-1",
                  email: "admin@example.com",
                  display_name: "Administrator",
                },
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }

        if (url === "/api/v1/me/permissions") {
          return Promise.resolve(
            new Response(JSON.stringify({ permissions: ["CreateProjects"] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }

        if (url === "/api/v1/projects") {
          return Promise.resolve(
            new Response("[]", {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp(["/projects"]);

    expect(await screen.findByText("Owned and assigned projects")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("0 visible")).toBeInTheDocument();
    });
  });

  it("creates a translation from the project workspace", async () => {
    const user = userEvent.setup();
    const translations = [
      {
        id: "translation-1",
        translation_key_id: "key-1",
        key: "button.save",
        description: "Initial value",
        namespace: "common",
        language_code: "en",
        environment_slug: "production",
        value: "Save",
        updated_by_user_id: "user-1",
        created_at: "2026-06-19T00:00:00Z",
        updated_at: "2026-06-19T00:00:00Z",
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
        const method = init?.method ?? "GET";
        const path = `${url.pathname}${url.search}`;

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
            permissions: ["EditProjects", "EditTranslations", "DeleteTranslations", "ImportTranslations", "ManageProjectMembers", "ReadProduction", "EditProduction"],
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

        if (
          path ===
          "/api/v1/projects/demo-project/translations?environment=production&language=en&namespace=common"
        ) {
          return jsonResponse(translations);
        }

        if (path === "/api/v1/projects/demo-project/translations" && method === "POST") {
          const body = JSON.parse(String(init?.body));
          translations.push({
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
          });
          return jsonResponse(translations[translations.length - 1], 201);
        }

        throw new Error(`Unexpected request: ${method} ${path}`);
      }),
    );

    renderApp(["/projects/demo-project"]);

    expect(await screen.findByText("Demo Project")).toBeInTheDocument();
    expect(await screen.findByText("button.save")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("button.save"), "cta.publish");
    await user.type(screen.getByPlaceholderText("Save"), "Publish");
    await user.type(screen.getByPlaceholderText("Optional description"), "Publish CTA");
    await user.click(screen.getByRole("button", { name: "Create translation" }));

    expect(await screen.findByText("cta.publish")).toBeInTheDocument();
    expect(screen.getByText("Publish")).toBeInTheDocument();
    expect(screen.getByText("Publish CTA")).toBeInTheDocument();
  });

  it("disables restricted translation actions for a member without edit permissions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
        const method = init?.method ?? "GET";
        const path = `${url.pathname}${url.search}`;

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

        if (path === "/api/v1/projects/demo-project/members") {
          return jsonResponse([
            {
              id: "user-2",
              email: "member@example.com",
              display_name: "Member",
              is_active: true,
              is_owner: false,
              added_at: "2026-06-19T00:00:00Z",
            },
          ]);
        }

        if (
          path ===
          "/api/v1/projects/demo-project/translations?environment=production&language=en&namespace=common"
        ) {
          return jsonResponse([]);
        }

        throw new Error(`Unexpected request: ${method} ${path}`);
      }),
    );

    renderApp(["/projects/demo-project"]);

    expect(await screen.findByText("Member Workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create translation" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import JSON" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add member" })).toBeDisabled();
  });
});
