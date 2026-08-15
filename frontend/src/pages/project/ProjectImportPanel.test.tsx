import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Environment, Language, Namespace, Project } from "../../api";
import {
  ProjectImportPanel,
  createExportFilename,
  parseImportPreview,
} from "./ProjectImportPanel";

let mockPermissions = new Set<string>(["ImportTranslations", "ExportTranslations", "EditAll", "EditProd"]);

vi.mock("../../hooks/usePermissionSet", () => ({
  usePermissionSet: () => ({ has: (code: string) => mockPermissions.has(code) }),
}));

const project: Project = {
  id: "project-1",
  name: "Demo Project",
  slug: "demo-project",
  description: null,
  owner_user_id: "user-1",
  created_at: "2026-08-06T00:00:00Z",
  updated_at: "2026-08-06T00:00:00Z",
  is_owner: true,
};

const nonOwnerProject: Project = {
  ...project,
  owner_user_id: "someone-else",
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
  {
    id: "environment-2",
    project_id: project.id,
    name: "Development",
    slug: "development",
    created_at: "2026-08-06T00:00:00Z",
    updated_at: "2026-08-06T00:00:00Z",
  },
];

class MockXMLHttpRequest {
  static requests: MockXMLHttpRequest[] = [];
  static responseStatus = 200;
  static responseBody: unknown = { imported: 2 };

  upload = {
    onprogress: null as ((event: ProgressEvent) => void) | null,
  };
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  responseText = "";
  status = 0;
  withCredentials = false;
  method = "";
  path = "";
  requestBody: XMLHttpRequestBodyInit | Document | null = null;

  constructor() {
    MockXMLHttpRequest.requests.push(this);
  }

  open(method: string, path: string) {
    this.method = method;
    this.path = path;
  }

  setRequestHeader() {}

  send(body: XMLHttpRequestBodyInit | Document | null) {
    this.requestBody = body;
    queueMicrotask(() => {
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: 100,
        total: 100,
      } as ProgressEvent);
      this.status = MockXMLHttpRequest.responseStatus;
      this.responseText = JSON.stringify(MockXMLHttpRequest.responseBody);
      this.onload?.();
    });
  }
}

function renderPanel(projectOverride: Project = project) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectImportPanel
        environments={environments}
        languages={languages}
        namespaces={namespaces}
        project={projectOverride}
        projectSlug={projectOverride.slug}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  MockXMLHttpRequest.requests = [];
  MockXMLHttpRequest.responseStatus = 200;
  MockXMLHttpRequest.responseBody = { imported: 2 };
  vi.stubGlobal("XMLHttpRequest", MockXMLHttpRequest);
  mockPermissions = new Set(["ImportTranslations", "ExportTranslations", "EditAll", "EditProd"]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("import JSON validation", () => {
  it("accepts a flat key-to-string object and reports its key count", () => {
    expect(parseImportPreview('{"button.save":"Save","button.cancel":"Cancel"}')).toEqual({
      status: "valid",
      entryCount: 2,
      values: {
        "button.save": "Save",
        "button.cancel": "Cancel",
      },
    });
  });

  it("returns clear messages for invalid JSON and unsupported values", () => {
    expect(parseImportPreview('{"button.save":}')).toMatchObject({
      status: "invalid",
      error: expect.stringContaining("Invalid JSON. Check quotes, commas, and brackets."),
    });
    expect(parseImportPreview('{"retry.count":3}')).toEqual({
      status: "invalid",
      error: 'The value for "retry.count" must be a string. Numbers, objects, arrays, and null are not supported.',
    });
  });

  it("rejects keys and values that exceed backend limits", () => {
    expect(parseImportPreview(JSON.stringify({ ["k".repeat(501)]: "value" }), "common")).toMatchObject({
      status: "invalid",
      error: expect.stringContaining("must be at most 500 characters"),
    });
    expect(parseImportPreview(JSON.stringify({ valid: "v".repeat(10_001) }), "common")).toEqual({
      status: "invalid",
      error: 'The value for "valid" must be at most 10000 characters.',
    });
  });

  it("rejects namespace-prefixed, unsupported, and empty import entries", () => {
    expect(parseImportPreview('{"common.button.save":"Save"}', "common")).toMatchObject({
      status: "invalid",
      error: expect.stringContaining("must not include the namespace prefix"),
    });
    expect(parseImportPreview('{"button{save}":"Save"}', "common")).toMatchObject({
      status: "invalid",
      error: expect.stringContaining("unsupported characters"),
    });
    expect(parseImportPreview('{"button.save":"   "}', "common")).toEqual({
      status: "invalid",
      error: 'The value for "button.save" cannot be empty.',
    });
  });
});

describe("ProjectImportPanel", () => {
  it("previews the number of keys before import and reports the imported count", async () => {
    const user = userEvent.setup();
    renderPanel();

    const importButton = screen.getByRole("button", { name: "Import JSON" });
    expect(importButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("JSON object"), {
      target: { value: '{"button.save":"Save","button.cancel":"Cancel"}' },
    });

    expect(screen.getByText("2 translation keys found in this JSON object.")).toBeInTheDocument();
    expect(importButton).toBeEnabled();

    await user.click(importButton);

    expect(await screen.findByText("Imported 2 translations.")).toBeInTheDocument();
    expect(MockXMLHttpRequest.requests).toHaveLength(1);
    expect(MockXMLHttpRequest.requests[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/projects/demo-project/imports/json",
      withCredentials: true,
    });
    expect(JSON.parse(String(MockXMLHttpRequest.requests[0].requestBody))).toEqual({
      environment: "production",
      language: "en",
      namespace: "common",
      values: {
        "button.save": "Save",
        "button.cancel": "Cancel",
      },
    });
  });

  it("blocks import and shows a clear syntax error for invalid JSON", () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText("JSON object"), {
      target: { value: '{"button.save":}' },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid JSON. Check quotes, commas, and brackets.",
    );
    expect(screen.getByRole("button", { name: "Import JSON" })).toBeDisabled();
    expect(MockXMLHttpRequest.requests).toHaveLength(0);
  });

  it("renders a backend validation error returned during upload", async () => {
    MockXMLHttpRequest.responseStatus = 400;
    MockXMLHttpRequest.responseBody = {
      error: {
        code: "ValidationError",
        message: 'Translation value for key "button.save" cannot be empty.',
      },
    };
    const user = userEvent.setup();
    renderPanel();

    fireEvent.change(screen.getByLabelText("JSON object"), {
      target: { value: '{"button.save":"Save"}' },
    });
    await user.click(screen.getByRole("button", { name: "Import JSON" }));

    expect(
      await screen.findByText('Translation value for key "button.save" cannot be empty.'),
    ).toBeInTheDocument();
  });

  it("downloads exported translations as a named JSON file", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ "button.save": "Save", "button.cancel": "Cancel" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const createObjectUrl = vi.fn(() => "blob:export");
    const revokeObjectUrl = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectUrl },
      revokeObjectURL: { configurable: true, value: revokeObjectUrl },
    });
    let downloadedFilename = "";
    let downloadedHref = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFilename = this.download;
      downloadedHref = this.href;
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Export JSON" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(
      await screen.findByText(
        "Downloaded 2 translations to demo-project-production-en-common.json.",
      ),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/projects/demo-project/exports/json?environment=production&language=en&namespace=common",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(downloadedFilename).toBe("demo-project-production-en-common.json");
    expect(downloadedHref).toBe("blob:export");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:export");
  });
});

describe("ProjectImportPanel import permission gating (OXR-60)", () => {
  const deniedBannerText = /Import requires owner access or the/;

  it("disables import for a production target when ImportTranslations is held but EditProd is not", () => {
    mockPermissions = new Set(["ImportTranslations", "EditAll"]);
    renderPanel(nonOwnerProject);

    expect(screen.getByText(deniedBannerText)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import JSON" })).toBeDisabled();
  });

  it("disables import for a production target when EditProd is held but ImportTranslations is not", () => {
    mockPermissions = new Set(["EditProd"]);
    renderPanel(nonOwnerProject);

    expect(screen.getByText(deniedBannerText)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import JSON" })).toBeDisabled();
  });

  it("allows import for a production target once both ImportTranslations and EditProd are held", () => {
    mockPermissions = new Set(["ImportTranslations", "EditProd"]);
    renderPanel(nonOwnerProject);

    expect(screen.queryByText(deniedBannerText)).not.toBeInTheDocument();
  });

  it("disables import for a non-production target when only EditProd (not EditAll) is held", () => {
    mockPermissions = new Set(["ImportTranslations", "EditProd"]);
    renderPanel(nonOwnerProject);

    fireEvent.change(screen.getByLabelText("Environment"), {
      target: { value: "development" },
    });

    expect(screen.getByText(deniedBannerText)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import JSON" })).toBeDisabled();
  });

  it("allows import for a non-production target once ImportTranslations and EditAll are held, without EditProd", () => {
    mockPermissions = new Set(["ImportTranslations", "EditAll"]);
    renderPanel(nonOwnerProject);

    fireEvent.change(screen.getByLabelText("Environment"), {
      target: { value: "development" },
    });

    expect(screen.queryByText(deniedBannerText)).not.toBeInTheDocument();
  });
});

describe("createExportFilename", () => {
  it("creates a safe and descriptive JSON filename", () => {
    expect(createExportFilename("demo-project", "production", "en", "checkout flow")).toBe(
      "demo-project-production-en-checkout-flow.json",
    );
  });
});
