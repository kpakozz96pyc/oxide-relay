export type ApiError = Error & {
  status?: number;
  code?: string;
};

export type Project = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
  is_owner: boolean;
};

export type Language = {
  id: string;
  project_id: string;
  code: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type Namespace = {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type Environment = {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
};

export type DeliveryManifestNamespace = {
  name: string;
  version: string;
  url: string;
};

export type DeliveryManifest = {
  project: string;
  locale: string;
  environment: string;
  locale_bundle_version: string;
  locale_bundle_url: string;
  namespaces: DeliveryManifestNamespace[];
};

export type Translation = {
  id: string;
  translation_key_id: string;
  key: string;
  description: string | null;
  namespace: string;
  language_code: string;
  environment_slug: string;
  value: string;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TranslationGridValue = {
  id: string | null;
  value: string;
};

export type TranslationGridRow = {
  representative_translation_id: string;
  translation_key_id: string;
  key: string;
  description: string | null;
  namespace: string;
  values: Record<string, TranslationGridValue>;
};

export type TranslationGridResponse = {
  items: TranslationGridRow[];
  total: number;
  page: number;
  page_size: number;
};

export type ProjectMember = {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  is_owner: boolean;
  added_at: string;
};

export type User = {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Permission = {
  id: string;
  code: string;
  description: string | null;
};

export type PasswordResetLinkResponse = {
  reset_url: string;
  expires_at: string;
};

export type CurrentPermissionsResponse = {
  permissions: string[];
};

type ErrorEnvelope = {
  error?: {
    code?: string;
    message?: string;
  };
};

export async function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function apiDelete(path: string): Promise<void> {
  await request<void>(path, { method: "DELETE" });
}

export function buildErrorMessage(error: unknown): string {
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return "errors.unexpected";
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const payload = (await parseJson(response)) as ErrorEnvelope | null;
    const error = new Error(
      payload?.error?.message ?? `Request failed with status ${response.status}`,
    ) as ApiError;
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await parseJson(response)) as T;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}
