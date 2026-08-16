import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Permission, ProjectCatalogItem, UserProjectAccess, UserSummary } from "../../api";
import { SelectedUserPanel } from "./SelectedUserPanel";

const selectedUser: UserSummary = {
  id: "user-1",
  email: "member@example.com",
  display_name: "Member One",
  is_active: true,
  created_at: "2026-08-06T00:00:00Z",
  updated_at: "2026-08-06T00:00:00Z",
  direct_permissions_count: 1,
  project_access_count: 0,
  selected_project_relation: null,
};

const permissionsCatalog: Permission[] = [
  { id: "perm-read", code: "ReadTranslations", description: "Read translations" },
];

const userPermissions: Permission[] = [];

const projectAccess: UserProjectAccess[] = [];
const projectCatalog: ProjectCatalogItem[] = [];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPanel(putResponder: () => Response) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/api/v1/me") {
      return Promise.resolve(jsonResponse({ user: { id: "admin-1", email: "a@example.com", display_name: "Admin" } }));
    }
    if (path === `/api/v1/users/${selectedUser.id}/permissions` && init?.method === "PUT") {
      return Promise.resolve(putResponder());
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SelectedUserPanel
        canManagePermissions
        canManageUsers
        onDeleted={() => {}}
        permissionsCatalog={permissionsCatalog}
        permissionsLoading={false}
        projectAccess={projectAccess}
        projectAccessLoading={false}
        projectCatalog={projectCatalog}
        selectedUser={selectedUser}
        userPermissions={userPermissions}
      />
    </QueryClientProvider>,
  );

  // Every "Save permissions" click confirms first (OXR-77); default to confirming so
  // existing save-flow tests don't need to know about the dialog unless they're testing it.
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

  return { fetchMock, confirmSpy };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SelectedUserPanel permission save feedback (OXR-65)", () => {
  it("shows the success feedback next to the Save permissions action, not only at the top", async () => {
    const user = userEvent.setup();
    renderPanel(() => jsonResponse({}));

    await user.click(screen.getByRole("button", { name: "Permissions" }));
    await user.click(screen.getByRole("checkbox", { name: /ReadTranslations/ }));
    await user.click(screen.getByRole("button", { name: "Save permissions" }));

    const feedback = await screen.findByRole("status");
    expect(feedback).toHaveTextContent("Permissions saved.");

    // The feedback must live in the same action row as the Save button, i.e. right
    // beside it, instead of requiring a scroll back up to the top of the tab.
    const saveButton = screen.getByRole("button", { name: "Save permissions" });
    expect(saveButton.closest(".action-row")).toBe(feedback.closest(".action-row"));
  });

  it("shows the failure feedback next to the Save permissions action", async () => {
    const user = userEvent.setup();
    renderPanel(() => jsonResponse({ error: { message: "Cannot grant that permission." } }, 400));

    await user.click(screen.getByRole("button", { name: "Permissions" }));
    await user.click(screen.getByRole("checkbox", { name: /ReadTranslations/ }));
    await user.click(screen.getByRole("button", { name: "Save permissions" }));

    const feedback = await screen.findByRole("alert");
    expect(feedback).toHaveTextContent("Cannot grant that permission.");
    const saveButton = screen.getByRole("button", { name: "Save permissions" });
    expect(saveButton.closest(".action-row")).toBe(feedback.closest(".action-row"));
  });

  it("does not show stale save feedback before any save attempt", async () => {
    const user = userEvent.setup();
    renderPanel(() => jsonResponse({}));

    await user.click(screen.getByRole("button", { name: "Permissions" }));

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("SelectedUserPanel permission save confirmation (OXR-77)", () => {
  it("confirms before submitting any permission change, naming the affected user", async () => {
    const user = userEvent.setup();
    const { fetchMock, confirmSpy } = renderPanel(() => jsonResponse({}));

    await user.click(screen.getByRole("button", { name: "Permissions" }));
    await user.click(screen.getByRole("checkbox", { name: /ReadTranslations/ }));
    await user.click(screen.getByRole("button", { name: "Save permissions" }));

    expect(confirmSpy).toHaveBeenCalledWith('Save permission changes for "Member One"?');
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            new URL(String(input), "http://localhost").pathname ===
              `/api/v1/users/${selectedUser.id}/permissions` && init?.method === "PUT",
        ),
      ).toBe(true);
    });
  });

  it("does not submit the permission change when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    const { fetchMock, confirmSpy } = renderPanel(() => jsonResponse({}));
    confirmSpy.mockReturnValue(false);

    await user.click(screen.getByRole("button", { name: "Permissions" }));
    await user.click(screen.getByRole("checkbox", { name: /ReadTranslations/ }));
    await user.click(screen.getByRole("button", { name: "Save permissions" }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          new URL(String(input), "http://localhost").pathname ===
            `/api/v1/users/${selectedUser.id}/permissions` && init?.method === "PUT",
      ),
    ).toBe(false);
    // The checkbox stays checked: cancelling the save leaves the in-progress draft intact.
    expect(screen.getByRole("checkbox", { name: /ReadTranslations/ })).toBeChecked();
  });
});
