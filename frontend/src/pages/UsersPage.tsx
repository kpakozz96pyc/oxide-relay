import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  buildErrorMessage,
  type User,
  type Permission,
  type PasswordResetLinkResponse,
} from "../api";
import { usePermissionSet } from "../hooks/usePermissionSet";
import { useTranslation } from "../i18n";
import { LoadingScreen } from "../components/LoadingScreen";
import { ErrorCard } from "../components/ErrorCard";

export function UsersPage() {
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [permissionText, setPermissionText] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [generatedResetLink, setGeneratedResetLink] = useState<PasswordResetLinkResponse | null>(null);
  const queryClient = useQueryClient();
  const permissionSet = usePermissionSet();
  const { t } = useTranslation();
  const canManageUsers = permissionSet.has("ManageUsers");
  const canManagePermissions = permissionSet.has("ManagePermissions");

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => apiGet<User[]>("/api/v1/users"),
    enabled: canManageUsers,
  });

  const permissionsQuery = useQuery({
    queryKey: ["permissions"],
    queryFn: () => apiGet<Permission[]>("/api/v1/permissions"),
    enabled: canManagePermissions,
  });

  const userPermissionsQuery = useQuery({
    queryKey: ["user-permissions", selectedUserId],
    queryFn: () => apiGet<Permission[]>(`/api/v1/users/${selectedUserId}/permissions`),
    enabled: Boolean(selectedUserId) && canManagePermissions,
  });

  useEffect(() => {
    if (!selectedUserId && usersQuery.data?.[0]) {
      setSelectedUserId(usersQuery.data[0].id);
    }
  }, [selectedUserId, usersQuery.data]);

  useEffect(() => {
    const selectedUser = usersQuery.data?.find((user) => user.id === selectedUserId);
    if (selectedUser) {
      setEditEmail(selectedUser.email);
      setEditDisplayName(selectedUser.display_name);
      setEditPassword("");
      setEditIsActive(selectedUser.is_active);
      setGeneratedResetLink(null);
    }
  }, [selectedUserId, usersQuery.data]);

  useEffect(() => {
    if (userPermissionsQuery.data) {
      setPermissionText(userPermissionsQuery.data.map((item) => item.code).join("\n"));
    }
  }, [userPermissionsQuery.data]);

  const createUserMutation = useMutation({
    mutationFn: async () =>
      apiPost("/api/v1/users", {
        email: newEmail,
        password: newPassword,
        display_name: newDisplayName,
        is_active: true,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      setNewEmail("");
      setNewPassword("");
      setNewDisplayName("");
    },
  });

  const replacePermissionsMutation = useMutation({
    mutationFn: async () =>
      apiPut(`/api/v1/users/${selectedUserId}/permissions`, {
        permission_codes: permissionText
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["user-permissions", selectedUserId] });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async () =>
      apiPut(`/api/v1/users/${selectedUserId}`, {
        email: editEmail,
        display_name: editDisplayName,
        password: editPassword || undefined,
        is_active: editIsActive,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async () => apiDelete(`/api/v1/users/${selectedUserId}`),
    onSuccess: async () => {
      const previousUsers = usersQuery.data ?? [];
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      const nextUsers = previousUsers.filter((user) => user.id !== selectedUserId);
      setSelectedUserId(nextUsers[0]?.id ?? "");
    },
  });

  const generateResetLinkMutation = useMutation({
    mutationFn: async () =>
      apiPost<PasswordResetLinkResponse>(`/api/v1/users/${selectedUserId}/password-reset-link`, undefined),
    onSuccess: (response) => {
      setGeneratedResetLink(response);
    },
  });

  if (!canManageUsers && !canManagePermissions) {
    return (
      <ErrorCard
        title={t("users.error.title")}
        message={t("users.error.forbidden")}
      />
    );
  }

  if ((canManageUsers && usersQuery.isLoading) || (canManagePermissions && permissionsQuery.isLoading)) {
    return <LoadingScreen label={t("users.loading")} compact />;
  }

  if (canManageUsers && usersQuery.isError) {
    return <ErrorCard title={t("users.error.title")} message={buildErrorMessage(usersQuery.error)} />;
  }

  if (canManagePermissions && permissionsQuery.isError) {
    return <ErrorCard title={t("users.permissions.error.title")} message={buildErrorMessage(permissionsQuery.error)} />;
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("users.eyebrow")}</p>
          <h1 className="page-title">{t("users.title")}</h1>
        </div>
      </header>

      {createUserMutation.isError ? (
        <div className="banner error">{buildErrorMessage(createUserMutation.error)}</div>
      ) : null}
      {replacePermissionsMutation.isError ? (
        <div className="banner error">{buildErrorMessage(replacePermissionsMutation.error)}</div>
      ) : null}
      {updateUserMutation.isError ? (
        <div className="banner error">{buildErrorMessage(updateUserMutation.error)}</div>
      ) : null}
      {deleteUserMutation.isError ? (
        <div className="banner error">{buildErrorMessage(deleteUserMutation.error)}</div>
      ) : null}
      {generateResetLinkMutation.isError ? (
        <div className="banner error">{buildErrorMessage(generateResetLinkMutation.error)}</div>
      ) : null}

      <div className="workspace-grid">
        <article className="panel stack gap-md">
          <header className="panel-header">
            <h2>{t("users.create.title")}</h2>
          </header>
          <div className="form-grid">
            <label className="field">
              <span>{t("users.fields.email")}</span>
              <input value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
            </label>
            <label className="field">
              <span>{t("users.fields.display_name")}</span>
              <input value={newDisplayName} onChange={(event) => setNewDisplayName(event.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>{t("users.fields.password")}</span>
            <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          </label>
          <button
            className="button primary"
            disabled={createUserMutation.isPending || !canManageUsers}
            onClick={() => createUserMutation.mutate()}
          >
            {t("users.create.submit")}
          </button>

          <div className="divider" />

          <header className="panel-header">
            <h2>{t("users.list.title")}</h2>
            <span className="badge">{usersQuery.data?.length ?? 0}</span>
          </header>
          {usersQuery.data?.map((user) => (
            <button
              className={`member-card selectable${selectedUserId === user.id ? " selected" : ""}`}
              key={user.id}
              onClick={() => setSelectedUserId(user.id)}
              type="button"
            >
              <div className="stack gap-sm">
                <strong>{user.display_name}</strong>
                <span className="muted">{user.email}</span>
              </div>
              <span className="badge subtle">{user.is_active ? t("users.badges.active") : t("users.badges.inactive")}</span>
            </button>
          ))}
        </article>

        <article className="panel stack gap-md">
          <header className="panel-header">
            <h2>{t("users.permissions.title")}</h2>
          </header>
          <label className="field">
            <span>{t("users.permissions.selected_user")}</span>
            <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
              {usersQuery.data?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("users.permissions.codes")}</span>
            <textarea
              className="textarea"
              rows={12}
              value={permissionText}
              onChange={(event) => setPermissionText(event.target.value)}
              placeholder={t("users.permissions.codes_placeholder")}
            />
          </label>
          <button
            className="button secondary"
            disabled={!selectedUserId || replacePermissionsMutation.isPending || !canManagePermissions}
            onClick={() => replacePermissionsMutation.mutate()}
          >
            {t("users.permissions.replace")}
          </button>
          <div className="divider" />
          <header className="panel-header">
            <h2>{t("users.update.title")}</h2>
          </header>
          <div className="form-grid">
            <label className="field">
              <span>{t("users.fields.email")}</span>
              <input value={editEmail} onChange={(event) => setEditEmail(event.target.value)} />
            </label>
            <label className="field">
              <span>{t("users.fields.display_name")}</span>
              <input value={editDisplayName} onChange={(event) => setEditDisplayName(event.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>{t("users.fields.password")}</span>
            <input
              type="password"
              value={editPassword}
              onChange={(event) => setEditPassword(event.target.value)}
              placeholder={t("users.update.password_placeholder")}
            />
          </label>
          <label className="checkbox-row">
            <input checked={editIsActive} onChange={(event) => setEditIsActive(event.target.checked)} type="checkbox" />
            <span>{t("users.update.is_active")}</span>
          </label>
          <div className="action-row">
            <button
              className="button ghost"
              disabled={!selectedUserId || generateResetLinkMutation.isPending || !canManageUsers}
              onClick={() => {
                setGeneratedResetLink(null);
                generateResetLinkMutation.mutate();
              }}
            >
              {generateResetLinkMutation.isPending
                ? t("users.reset_link.pending")
                : t("users.reset_link.generate")}
            </button>
          </div>
          {generatedResetLink ? (
            <div className="banner info stack gap-sm">
              <strong>{t("users.reset_link.generated_title")}</strong>
              <span>{t("users.reset_link.one_time_notice")}</span>
              <code className="inline-code-block">{generatedResetLink.reset_url}</code>
              <span>{`${t("users.reset_link.expires_at")} ${generatedResetLink.expires_at}`}</span>
              <div className="action-row">
                <button
                  className="button secondary"
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(
                      `${window.location.origin}${generatedResetLink.reset_url}`,
                    );
                  }}
                >
                  {t("actions.copy")}
                </button>
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => setGeneratedResetLink(null)}
                >
                  {t("actions.clear")}
                </button>
              </div>
            </div>
          ) : null}
          <div className="action-row">
            <button
              className="button secondary"
              disabled={!selectedUserId || updateUserMutation.isPending || !canManageUsers}
              onClick={() => updateUserMutation.mutate()}
            >
              {t("users.update.save")}
            </button>
            <button
              className="button ghost danger"
              disabled={!selectedUserId || deleteUserMutation.isPending || !canManageUsers}
              onClick={() => deleteUserMutation.mutate()}
            >
              {t("users.update.delete")}
            </button>
          </div>
          <div className="divider" />
          <header className="panel-header">
            <h2>{t("users.catalog.title")}</h2>
            <span className="badge">{permissionsQuery.data?.length ?? 0}</span>
          </header>
          <div className="permission-grid">
            {permissionsQuery.data?.map((permission) => (
              <div className="permission-card" key={permission.id}>
                <strong>{permission.code}</strong>
                <span className="muted">{permission.description ?? t("users.catalog.no_description")}</span>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
