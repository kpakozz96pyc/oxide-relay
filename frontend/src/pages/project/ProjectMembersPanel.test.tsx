import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemberCandidate, ProjectMember } from "../../api";
import { ProjectMembersPanel } from "./ProjectMembersPanel";

const members: ProjectMember[] = [
  {
    id: "owner-1",
    email: "owner@example.com",
    display_name: "Owner One",
    is_active: true,
    is_owner: true,
    added_at: "2026-08-06T00:00:00Z",
  },
];

const candidates: MemberCandidate[] = [
  { id: "candidate-1", email: "ada@example.com", display_name: "Ada Lovelace" },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPanel() {
  const addMemberCalls: unknown[] = [];
  const searchQueries: string[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;

    if (path === "/api/v1/projects/demo-project/members" && (!init || init.method === undefined)) {
      return Promise.resolve(jsonResponse(members));
    }
    if (path === "/api/v1/projects/demo-project/members" && init?.method === "POST") {
      addMemberCalls.push(init.body ? JSON.parse(String(init.body)) : null);
      return Promise.resolve(
        jsonResponse(
          {
            id: "candidate-1",
            email: "ada@example.com",
            display_name: "Ada Lovelace",
            is_active: true,
            is_owner: false,
            added_at: "2026-08-06T00:00:00Z",
          },
          201,
        ),
      );
    }
    if (path === "/api/v1/projects/demo-project/members/search") {
      const q = url.searchParams.get("q") ?? "";
      searchQueries.push(q);
      return Promise.resolve(jsonResponse(q.length > 0 ? candidates : []));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ProjectMembersPanel
        canManageMembers
        canViewMembers
        projectOwnerId="owner-1"
        projectSlug="demo-project"
      />
    </QueryClientProvider>,
  );

  return { addMemberCalls, searchQueries, fetchMock };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProjectMembersPanel searchable member picker (OXR-68)", () => {
  it("does not search until the user types, then lists matching candidates by name and email", async () => {
    const user = userEvent.setup();
    const { searchQueries } = renderPanel();

    await user.click(await screen.findByRole("button", { name: "Add member" }));
    expect(screen.getByText(/Type at least one character/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search by name or email"), "ada");

    expect(await screen.findByRole("button", { name: /Ada Lovelace/ })).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    await waitFor(() => {
      expect(searchQueries.some((q) => q === "ada")).toBe(true);
    });
  });

  it("adds the selected candidate's user id, not raw typed text", async () => {
    const user = userEvent.setup();
    const { addMemberCalls } = renderPanel();

    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(screen.getByLabelText("Search by name or email"), "ada");
    await user.click(await screen.findByRole("button", { name: /Ada Lovelace/ }));

    // Once selected, the search field is replaced by a confirmation summary and the
    // submit button becomes enabled only because a real candidate was picked.
    expect(screen.queryByLabelText("Search by name or email")).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    const submitButton = within(dialog).getByRole("button", { name: "Add member" });
    expect(submitButton).not.toBeDisabled();

    await user.click(submitButton);

    await waitFor(() => {
      expect(addMemberCalls).toEqual([{ user_id: "candidate-1" }]);
    });
  });

  it("keeps the Add member submit action disabled until a candidate is selected", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Add member" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Add member" })).toBeDisabled();

    await user.type(screen.getByLabelText("Search by name or email"), "ada");
    await screen.findByRole("button", { name: /Ada Lovelace/ });

    // Typing alone (without picking a result) must not enable the submit action.
    expect(within(dialog).getByRole("button", { name: "Add member" })).toBeDisabled();
  });
});
