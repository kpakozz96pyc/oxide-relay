import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, Environment, Language, Namespace, Project, buildErrorMessage } from "../../api";
import { usePermissionSet } from "../../hooks/usePermissionSet";
import { editEnvironmentPermission } from "../../lib/permissions";

type ImportStage = "idle" | "parsing" | "uploading" | "processing" | "success";

type PreparedImportPayload = {
  body: string;
  entryCount: number;
};

type ImportResponse = {
  imported?: number;
};

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
  const [importEntryCount, setImportEntryCount] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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

  const canImportTranslations =
    project.is_owner ||
    (permissionSet.has("ImportTranslations") && permissionSet.has(editEnvironmentPermission(environment)));

  const importMutation = useMutation({
    mutationFn: async () => {
      setSuccessMessage(null);
      setImportStage("parsing");
      setUploadProgress(8);

      const prepared = await prepareImportPayloadOffThread({
        environment,
        language,
        namespace,
        rawJson: importJson,
      });

      setImportEntryCount(prepared.entryCount);
      setImportStage("uploading");
      setUploadProgress(12);

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
        entryCount: prepared.entryCount,
      };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations-grid"] });
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations"] });
      setImportJson("");
      setImportStage("success");
      setUploadProgress(100);
      setSuccessMessage(`Imported ${result.imported} translations.`);
    },
    onError: () => {
      setImportStage("idle");
      setUploadProgress(0);
    },
  });

  const progressLabel = useMemo(() => {
    switch (importStage) {
      case "parsing":
        return "Parsing JSON in a background worker...";
      case "uploading":
        return `Uploading payload... ${Math.round(uploadProgress)}%`;
      case "processing":
        return "Upload complete. Waiting for the server to finish importing...";
      case "success":
        return successMessage ?? "Import completed successfully.";
      default:
        return null;
    }
  }, [importStage, successMessage, uploadProgress]);

  return (
    <article className="panel stack gap-md">
      <header className="panel-header">
        <div className="stack gap-sm">
          <h2>Import</h2>
          <p className="panel-copy">
            Import a JSON payload into the selected environment, language, and namespace using the existing project import flow.
          </p>
        </div>
      </header>

      {importMutation.isError ? (
        <div className="banner error">{buildErrorMessage(importMutation.error)}</div>
      ) : null}
      {successMessage ? <div className="banner success">{successMessage}</div> : null}

      {(importStage === "parsing" || importStage === "uploading" || importStage === "processing") && progressLabel ? (
        <div className="import-progress-card">
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
          {importEntryCount !== null ? (
            <p className="muted">{`Prepared ${importEntryCount} translation entries for import.`}</p>
          ) : null}
        </div>
      ) : null}

      <div className="project-resource-grid">
        <section className="stack gap-md">
          <div className="form-grid">
            <label className="field">
              <span>Environment</span>
              <select
                disabled={importMutation.isPending}
                value={environment}
                onChange={(event) => setEnvironment(event.target.value)}
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
                disabled={importMutation.isPending}
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                {languages.map((item) => (
                  <option key={item.id} value={item.code}>
                    {item.code}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Namespace</span>
            <select
              disabled={importMutation.isPending}
              value={namespace}
              onChange={(event) => setNamespace(event.target.value)}
            >
              {namespaces.map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>JSON payload</span>
            <textarea
              className="textarea"
              disabled={importMutation.isPending}
              onChange={(event) => {
                setImportJson(event.target.value);
                setSuccessMessage(null);
                setImportEntryCount(null);
              }}
              placeholder='{"button.save":"Save"}'
              rows={12}
              value={importJson}
            />
          </label>

          <div className="action-row">
            <button
              className="button primary"
              disabled={importMutation.isPending || !canImportTranslations || !importJson.trim()}
              onClick={() => importMutation.mutate()}
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

        <aside className="panel stack gap-md">
          <header className="panel-header">
            <div className="stack gap-sm">
              <h2>Import Notes</h2>
              <p className="panel-copy">Only real import targets from the current project model are available here.</p>
            </div>
          </header>
          <div className="stack gap-sm">
            <p className="muted">Large payload parsing runs in a background worker so the page stays responsive.</p>
            <p className="muted">The progress bar tracks upload progress. Server-side import processing is shown as a separate waiting phase.</p>
            <p className="muted">The payload must be a flat JSON object of translation keys to string values.</p>
          </div>
        </aside>
      </div>
    </article>
  );
}

function prepareImportPayloadOffThread({
  environment,
  language,
  namespace,
  rawJson,
}: {
  environment: string;
  language: string;
  namespace: string;
  rawJson: string;
}): Promise<PreparedImportPayload> {
  return new Promise((resolve, reject) => {
    const workerSource = `
      self.onmessage = (event) => {
        try {
          const { environment, language, namespace, rawJson } = event.data;
          const parsed = JSON.parse(rawJson);

          if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
            throw new Error("Import payload must be a flat JSON object.");
          }

          const entries = Object.entries(parsed);
          for (const [key, value] of entries) {
            if (typeof key !== "string" || key.trim().length === 0) {
              throw new Error("Import keys must be non-empty strings.");
            }
            if (typeof value !== "string") {
              throw new Error("Import values must be strings.");
            }
          }

          const body = JSON.stringify({
            environment,
            language,
            namespace,
            values: parsed,
          });

          self.postMessage({
            body,
            entryCount: entries.length,
          });
        } catch (error) {
          self.postMessage({
            error: error instanceof Error ? error.message : "Unable to prepare import payload.",
          });
        }
      };
    `;

    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "application/javascript" }));
    const worker = new Worker(workerUrl);

    worker.onmessage = (event: MessageEvent<{ body?: string; entryCount?: number; error?: string }>) => {
      URL.revokeObjectURL(workerUrl);
      worker.terminate();
      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }

      resolve({
        body: event.data.body ?? "{}",
        entryCount: event.data.entryCount ?? 0,
      });
    };

    worker.onerror = () => {
      URL.revokeObjectURL(workerUrl);
      worker.terminate();
      reject(new Error("Unable to prepare import payload."));
    };

    worker.postMessage({
      environment,
      language,
      namespace,
      rawJson,
    });
  });
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
          const payload = responseText ? (JSON.parse(responseText) as { error?: { message?: string } }) : null;
          const error = new Error(payload?.error?.message ?? `Request failed with status ${request.status}`) as ApiError;
          error.status = request.status;
          reject(error);
          return;
        } catch {
          reject(new Error(`Request failed with status ${request.status}`));
          return;
        }
      }

      onProgress(100);
      if (!responseText) {
        resolve({});
        return;
      }

      resolve(JSON.parse(responseText) as ImportResponse);
    };

    request.send(payload.body);
  });
}
