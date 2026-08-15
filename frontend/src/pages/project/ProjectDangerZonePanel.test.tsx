import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Project } from "../../api";
import { ProjectDangerZonePanel } from "./ProjectDangerZonePanel";

const project: Project = {
  id: "project-1",
  name: "Demo Project",
  slug: "demo-project",
  description: null,
  owner_user_id: "owner-1",
  created_at: "2026-08-06T00:00:00Z",
  updated_at: "2026-08-06T00:00:00Z",
  is_owner: true,
};

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProjectDangerZonePanel canDeleteProject project={project} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProjectDangerZonePanel delete confirmation slug (OXR-66)", () => {
  it("shows the required slug on its own labeled line, not embedded in a sentence", () => {
    renderPanel();

    const label = screen.getByText("Required slug");
    const slugRow = label.closest<HTMLElement>(".field");
    if (!slugRow) {
      throw new Error("expected the slug label to wrap the value row");
    }
    const slugValue = within(slugRow).getByText("demo-project");
    expect(slugValue).toBeInTheDocument();
    expect(slugValue).toHaveAttribute("aria-labelledby", label.id);

    // The old copy embedded the slug inside a sentence; that sentence must not still
    // require parsing to find the slug value (the value now lives in its own line).
    expect(screen.queryByText(/^Type demo-project to confirm/)).not.toBeInTheDocument();
  });

  it("copies the slug to the clipboard via the copy action", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderPanel();

    await user.click(screen.getByRole("button", { name: "Copy slug" }));

    expect(writeText).toHaveBeenCalledWith("demo-project");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("leaves the confirmation input and delete safeguard behavior unchanged", async () => {
    const user = userEvent.setup();
    renderPanel();

    const deleteButton = screen.getByRole("button", { name: "Delete project" });
    expect(deleteButton).toBeDisabled();

    await user.type(screen.getByLabelText("Project slug confirmation"), "wrong-slug");
    expect(deleteButton).toBeDisabled();

    await user.clear(screen.getByLabelText("Project slug confirmation"));
    await user.type(screen.getByLabelText("Project slug confirmation"), "demo-project");
    expect(deleteButton).toBeEnabled();
  });
});
