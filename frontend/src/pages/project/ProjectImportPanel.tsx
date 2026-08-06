import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  Environment,
  Language,
  Namespace,
  Project,
  apiGet,
  buildErrorMessage,
} from "../../api";
import { usePermissionSet } from "../../hooks/usePermissionSet";
import { editEnvironmentPermission } from "../../lib/permissions";

type ImportStage = "idle" | "uploading" | "processing" | "success";

type PreparedImportPayload = {
  body: string;
  entryCount: number;
};

type ImportResponse = {
  imported?: number;
};

type ImportPreview =
  | { status: "empty" }
  | { status: "invalid"; error: string }
  | { status: "valid"; entryCount: number; values: Record<string, string> };

export function ProjectImportPanel({
  project,
  projectSlug,
  languages,
  namespaces,
  environments,
}: {
  project: Project;
  projectSlug: string;
  languages: Language[];
  namespaces: Namespace[];
  environments: Environment[];
}) {
  const permissionSet = usePermissionSet();
  const queryClient = useQueryClient();
  const [environment, setEnvironment] = useState("");
  const [language, setLanguage] = useState("");
  const [namespace, setNamespace] = useState("");
  const [importJson, setImportJson] = useState("");
  const [importStage, setImportStage] = useState<ImportStage>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!environment && environments[0]) {
      setEnvironment(environments[0].slug);
    }
  }, [environment, environments]);

  useEffect(() => {
    if (!language && languages[0]) {
      setLanguage(languages[0].code);
    }
  }, [language, languages]);

  useEffect(() => {
    if (!namespace && namespaces[0]) {
      setNamespace(namespaces[0].name);
    }
  }, [namespace, namespaces]);

  const importPreview = parseImportPreview(importJson);
  const canImportTranslations =
    project.is_owner ||
    (permissionSet.has("ImportTranslations") && permissionSet.has(editEnvironmentPermission(environment)));
  const canExportTranslations = project.is_owner || permissionSet.has("ExportTranslations");
  const hasTarget = Boolean(environment && language && namespace);
  const exportFilename = createExportFilename(projectSlug, environment, language, namespace);

  const importMutation = useMutation({
    mutationFn: async (preview: Extract<ImportPreview, { status: "valid" }>) => {
      setImportSuccess(null);
      setImportStage("uploading");
      setUploadProgress(12);

      const prepared: PreparedImportPayload = {
        body: JSON.stringify({
          environment,
          language,
          namespace,
          values: preview.values,
        }),
        entryCount: preview.entryCount,
      };
      const response = await uploadImportPayload(
        `/api/v1/projects/${projectSlug}/imports/json`,
        prepared,
        (nextProgress) => {
          setImportStage(nextProgress >= 100 ? "processing" : "uploading");
          setUploadProgress(Math.max(12, Math.min(100, nextProgress)));
        },
      );

      return {
        imported: response.imported ?? prepared.entryCount,
      };
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations-grid"] }),
        queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations"] }),
      ]);
      setImportJson("");
      setImportStage("success");
      setUploadProgress(100);
      setImportSuccess(`Imported ${result.imported} translations.`);
    },
    onError: () => {
      setImportStage("idle");
      setUploadProgress(0);
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      setExportSuccess(null);
      const query = new URLSearchParams({ environment, language, namespace });
      const values = await apiGet<Record<string, string>>(
        `/api/v1/projects/${projectSlug}/exports/json?${query.toString()}`,
      );
      downloadJsonFile(exportFilename, values);
      return Object.keys(values).length;
    },
    onSuccess: (exportedCount) => {
      setExportSuccess(`Downloaded ${exportedCount} translations to ${exportFilename}.`);
    },
  });

  const isBusy = importMutation.isPending || exportMutation.isPending;
  const progressLabel = getImportProgressLabel(importStage, uploadProgress);

  function resetFeedback() {
    setImportSuccess(null);
    setExportSuccess(null);
    importMutation.reset();
    exportMutation.reset();
  }

  return (
    <article className="panel stack gap-md">
      <header className="panel-header">
        <div className="stack gap-sm">
          <h2>Import and export</h2>
          <p className="panel-copy">
            Choose one translation target, then import a JSON object or download its current values.
          </p>
        </div>
      </header>

      <div className="import-export-target-grid">
        <label className="field">
          <span>Environment</span>
          <select
            disabled={isBusy}
            value={environment}
            onChange={(event) => {
              setEnvironment(event.target.value);
              resetFeedback();
            }}
          >
            {environments.map((item) => (
              <option key={item.id} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Language</span>
          <select
            disabled={isBusy}
            value={language}
            onChange={(event) => {
              setLanguage(event.target.value);
              resetFeedback();
            }}
          >
            {languages.map((item) => (
              <option key={item.id} value={item.code}>
                {item.code} - {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Namespace</span>
          <select
            disabled={isBusy}
            value={namespace}
            onChange={(event) => {
              setNamespace(event.target.value);
              resetFeedback();
            }}
          >
            {namespaces.map((item) => (
              <option key={item.id} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="project-resource-grid import-export-grid">
        <section className="import-export-card stack gap-md">
          <header className="stack gap-sm">
            <h3>Import JSON</h3>
            <p className="panel-copy">
              Paste a flat JSON object. Each property name becomes a translation key and each value must be a string.
            </p>
          </header>

          {importMutation.isError ? (
            <div className="banner error" role="alert">
              {buildErrorMessage(importMutation.error)}
            </div>
          ) : null}
          {importSuccess ? <div className="banner success">{importSuccess}</div> : null}

          <label className="field">
            <span>JSON object</span>
            <textarea
              aria-describedby="import-json-feedback"
              aria-invalid={importPreview.status === "invalid"}
              className="textarea import-json-input"
              disabled={isBusy}
              onChange={(event) => {
                setImportJson(event.target.value);
                setImportSuccess(null);
                setImportStage("idle");
                setUploadProgress(0);
                importMutation.reset();
              }}
              placeholder={'{\n  "button.save": "Save",\n  "button.cancel": "Cancel"\n}'}
              rows={12}
              spellCheck={false}
              value={importJson}
            />
          </label>

          <div id="import-json-feedback">
            {importPreview.status === "valid" ? (
              <div className="banner info import-preview">
                <strong>Ready to import</strong>
                <span>{formatTranslationCount(importPreview.entryCount)} found in this JSON object.</span>
              </div>
            ) : null}
            {importPreview.status === "invalid" ? (
              <div className="banner error" role="alert">
                {importPreview.error}
              </div>
            ) : null}
            {importPreview.status === "empty" ? (
              <p className="field-hint">Paste JSON to preview the number of translation keys before importing.</p>
            ) : null}
          </div>

          {importMutation.isPending && progressLabel ? (
            <div className="import-progress-card" aria-live="polite">
              <div className="import-progress-header">
                <strong>Import in progress</strong>
                <span>{Math.round(uploadProgress)}%</span>
              </div>
              <div
                aria-hidden="true"
                className={`import-progress-bar${importStage === "processing" ? " is-processing" : ""}`}
              >
                <div className="import-progress-fill" style={{ width: `${uploadProgress}%` }} />
              </div>
              <p className="muted">{progressLabel}</p>
            </div>
          ) : null}

          <div className="action-row">
            <button
              className="button primary"
              disabled={
                isBusy ||
                !canImportTranslations ||
                !hasTarget ||
                importPreview.status !== "valid"
              }
              onClick={() => {
                if (importPreview.status === "valid") {
                  importMutation.mutate(importPreview);
                }
              }}
              type="button"
            >
              {importMutation.isPending ? "Importing..." : "Import JSON"}
            </button>
          </div>

          {!canImportTranslations ? (
            <div className="banner info">
              Import requires owner access or the <code>ImportTranslations</code> permission for the selected environment.
            </div>
          ) : null}
        </section>

        <aside className="import-export-card stack gap-md">
          <header className="stack gap-sm">
            <h3>Export JSON</h3>
            <p className="panel-copy">
              Download the selected namespace as a flat JSON object that can be imported again later.
            </p>
          </header>

          {exportMutation.isError ? (
            <div className="banner error" role="alert">
              {buildErrorMessage(exportMutation.error)}
            </div>
          ) : null}
          {exportSuccess ? <div className="banner success">{exportSuccess}</div> : null}

          <div className="export-file-preview">
            <span>Download file</span>
            <code>{exportFilename}</code>
          </div>

          <div className="action-row">
            <button
              className="button secondary"
              disabled={isBusy || !canExportTranslations || !hasTarget}
              onClick={() => exportMutation.mutate()}
              type="button"
            >
              {exportMutation.isPending ? "Preparing download..." : "Export JSON"}
            </button>
          </div>

          {!canExportTranslations ? (
            <div className="banner info">
              Export requires owner access or the <code>ExportTranslations</code> permission.
            </div>
          ) : null}
        </aside>
      </div>
    </article>
  );
}

export function parseImportPreview(rawJson: string): ImportPreview {
  if (!rawJson.trim()) {
    return { status: "empty" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The JSON could not be parsed.";
    return {
      status: "invalid",
      error: `Invalid JSON. Check quotes, commas, and brackets. ${detail}`,
    };
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    return {
      status: "invalid",
      error: 'Import JSON must be an object such as {"button.save":"Save"}.',
    };
  }

  const entries = Object.entries(parsed);
  if (entries.length > 5000) {
    return {
      status: "invalid",
      error: "Import JSON cannot contain more than 5000 translation keys.",
    };
  }

  for (const [key, value] of entries) {
    if (!key.trim()) {
      return { status: "invalid", error: "Every translation key must be a non-empty string." };
    }
    if (typeof value !== "string") {
      return {
        status: "invalid",
        error: `The value for "${key}" must be a string. Numbers, objects, arrays, and null are not supported.`,
      };
    }
  }

  return {
    status: "valid",
    entryCount: entries.length,
    values: parsed as Record<string, string>,
  };
}

export function createExportFilename(
  projectSlug: string,
  environment: string,
  language: string,
  namespace: string,
) {
  return [projectSlug, environment, language, namespace]
    .map((part) => part.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("-") + ".json";
}

function downloadJsonFile(filename: string, values: Record<string, string>) {
  const blob = new Blob([`${JSON.stringify(values, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function getImportProgressLabel(importStage: ImportStage, uploadProgress: number) {
  if (importStage === "uploading") {
    return `Uploading payload... ${Math.round(uploadProgress)}%`;
  }
  if (importStage === "processing") {
    return "Upload complete. Waiting for the server to finish importing...";
  }
  return null;
}

function formatTranslationCount(count: number) {
  return `${count} translation ${count === 1 ? "key" : "keys"}`;
}

function uploadImportPayload(
  path: string,
  payload: PreparedImportPayload,
  onProgress: (progress: number) => void,
): Promise<ImportResponse> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", path, true);
    request.withCredentials = true;
    request.setRequestHeader("Content-Type", "application/json");

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress((event.loaded / event.total) * 100);
      }
    };

    request.onerror = () => {
      reject(new Error("Network error while uploading import payload."));
    };

    request.onload = () => {
      const responseText = request.responseText?.trim();
      if (request.status < 200 || request.status >= 300) {
        try {
          const response = responseText ? (JSON.parse(responseText) as { error?: { message?: string } }) : null;
          const error = new Error(response?.error?.message ?? `Request failed with status ${request.status}`) as ApiError;
          error.status = request.status;
          reject(error);
        } catch {
          reject(new Error(`Request failed with status ${request.status}`));
        }
        return;
      }

      onProgress(100);
      if (!responseText) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(responseText) as ImportResponse);
      } catch {
        reject(new Error("The server returned an invalid import response."));
      }
    };

    request.send(payload.body);
  });
}
