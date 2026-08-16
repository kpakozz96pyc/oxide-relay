import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, X } from "lucide-react";
import {
  PasswordResetLinkResponse,
  Permission,
  ProjectCatalogItem,
  User,
  UserProjectAccess,
  UserSummary,
  apiDelete,
  apiPost,
  apiPut,
  buildErrorMessage,
} from "../../api";
import { useSession } from "../../hooks/useSession";
import { buildPermissionGroups } from "./permissionGroups";

const INSPECTOR_TABS = [
  { id: "profile", label: "Profile" },
  { id: "permissions", label: "Permissions" },
  { id: "project-access", label: "Project access" },
  { id: "security", label: "Security" },
] as const;

type InspectorTab = (typeof INSPECTOR_TABS)[number]["id"];

export function SelectedUserPanel({
  selectedUser,
  permissionsCatalog,
  userPermissions,
  projectAccess,
  projectCatalog,
  canManageUsers,
  canManagePermissions,
  permissionsLoading,
  projectAccessLoading,
  onDeleted,
}: {
  selectedUser: UserSummary | null;
  permissionsCatalog: Permission[];
  userPermissions: Permission[];
  projectAccess: UserProjectAccess[];
  projectCatalog: ProjectCatalogItem[];
  canManageUsers: boolean;
  canManagePermissions: boolean;
  permissionsLoading: boolean;
  projectAccessLoading: boolean;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const session = useSession();
  const [activeTab, setActiveTab] = useState<InspectorTab>("profile");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileIsActive, setProfileIsActive] = useState(true);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [permissionsDraft, setPermissionsDraft] = useState<string[]>([]);
  const [permissionsSuccess, setPermissionsSuccess] = useState<string | null>(null);
  const [isAddProjectAccessDialogOpen, setIsAddProjectAccessDialogOpen] = useState(false);
  const [selectedProjectSlugToAdd, setSelectedProjectSlugToAdd] = useState("");
  const [securityPassword, setSecurityPassword] = useState("");
  const [securitySuccess, setSecuritySuccess] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<PasswordResetLinkResponse | null>(null);
  const [resetLinkCopyState, setResetLinkCopyState] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (!selectedUser) {
      return;
    }
    setProfileEmail(selectedUser.email);
    setProfileDisplayName(selectedUser.display_name);
    setProfileIsActive(selectedUser.is_active);
    setProfileSuccess(null);
    setSecurityPassword("");
    setSecuritySuccess(null);
    setResetLink(null);
    setResetLinkCopyState("idle");
    setSelectedProjectSlugToAdd("");
  }, [selectedUser?.id, selectedUser?.email, selectedUser?.display_name, selectedUser?.is_active]);

  useEffect(() => {
    setPermissionsDraft(userPermissions.map((permission) => permission.code));
    setPermissionsSuccess(null);
  }, [selectedUser?.id, userPermissions]);

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) {
        throw new Error("No user selected.");
      }
      return apiPut<User>(`/api/v1/users/${selectedUser.id}`, {
        email: profileEmail,
        display_name: profileDisplayName,
        is_active: profileIsActive,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      setProfileSuccess("Profile updated.");
    },
  });

  const replacePermissionsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) {
        throw new Error("No user selected.");
      }
      return apiPut(`/api/v1/users/${selectedUser.id}/permissions`, {
        permission_codes: permissionsDraft,
      });
    },
    onSuccess: async () => {
      if (!selectedUser) {
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["user-permissions", selectedUser.id] });
      await queryClient.invalidateQueries({ queryKey: ["users-summary"] });
      setPermissionsSuccess("Permissions saved.");
    },
  });

  const addProjectAccessMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) {
        throw new Error("No user selected.");
      }
      return apiPost(`/api/v1/users/${selectedUser.id}/project-access`, {
        project_slug: selectedProjectSlugToAdd,
      });
    },
    onSuccess: async () => {
      if (!selectedUser) {
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["user-project-access", selectedUser.id] });
      await queryClient.invalidateQueries({ queryKey: ["users-summary"] });
      setIsAddProjectAccessDialogOpen(false);
      setSelectedProjectSlugToAdd("");
    },
  });

  const removeProjectAccessMutation = useMutation({
    mutationFn: async (projectSlug: string) => {
      if (!selectedUser) {
        throw new Error("No user selected.");
      }
      return apiDelete(`/api/v1/users/${selectedUser.id}/project-access/${projectSlug}`);
    },
    onSuccess: async () => {
      if (!selectedUser) {
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["user-project-access", selectedUser.id] });
      await queryClient.invalidateQueries({ queryKey: ["users-summary"] });
    },
  });

  const updatePasswordMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) {
        throw new Error("No user selected.");
      }
      return apiPut<User>(`/api/v1/users/${selectedUser.id}`, {
        password: securityPassword,
      });
    },
    onSuccess: async () => {
      setSecurityPassword("");
      setSecuritySuccess("Password updated.");
    },
  });

  const generateResetLinkMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) {
        throw new Error("No user selected.");
      }
      return apiPost<PasswordResetLinkResponse>(`/api/v1/users/${selectedUser.id}/password-reset-link`, undefined);
    },
    onSuccess: (response) => {
      setResetLink(response);
      setResetLinkCopyState("idle");
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) {
        throw new Error("No user selected.");
      }
      return apiDelete(`/api/v1/users/${selectedUser.id}`);
    },
    onSuccess: async () => {
      if (selectedUser && selectedUser.id === session.user?.id) {
        // Deleted our own account: the server already cleared the session cookie.
        // Clear the cached session immediately so the app redirects to /login
        // instead of leaving this page rendered with dead auth state.
        queryClient.setQueryData(["session"], null);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["users-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      onDeleted();
    },
  });

  const profileDirty = Boolean(
    selectedUser &&
      (profileEmail.trim() !== selectedUser.email ||
        profileDisplayName.trim() !== selectedUser.display_name ||
        profileIsActive !== selectedUser.is_active),
  );

  const currentPermissionCodes = useMemo(
    () => userPermissions.map((permission) => permission.code).sort(),
    [userPermissions],
  );
  const permissionsDirty = JSON.stringify([...permissionsDraft].sort()) !== JSON.stringify(currentPermissionCodes);
  const permissionGroups = useMemo(() => buildPermissionGroups(permissionsCatalog), [permissionsCatalog]);
  const selectedPermissionSet = useMemo(() => new Set(permissionsDraft), [permissionsDraft]);

  const addableProjects = projectAccess.filter(
    (item) => item.relation === "none" && item.can_manage_access,
  );

  if (!selectedUser) {
    return (
      <article className="panel users-inspector-empty">
        <strong>Select a user to view details.</strong>
      </article>
    );
  }

  const projectCatalogCount = projectCatalog.length;
  const currentUser = selectedUser;

  async function copyResetLink() {
    if (!resetLink) {
      return;
    }

    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API is unavailable.");
      }
      await navigator.clipboard.writeText(resetLink.reset_url);
      setResetLinkCopyState("copied");
    } catch {
      setResetLinkCopyState("error");
    }
  }

  function saveProfile() {
    const isDeactivating = currentUser.is_active && !profileIsActive;
    if (
      isDeactivating &&
      !window.confirm(`Deactivate user "${currentUser.display_name}"? They will no longer be able to sign in.`)
    ) {
      return;
    }
    updateProfileMutation.mutate();
  }

  function savePermissions() {
    // Permission changes can affect ManageUsers/ManagePermissions for the acting admin
    // themselves or for another active administrator, so every save is confirmed the same
    // way regardless of which permissions changed.
    if (!window.confirm(`Save permission changes for "${currentUser.display_name}"?`)) {
      return;
    }
    replacePermissionsMutation.mutate();
  }

  return (
    <article className="panel stack gap-md users-inspector">
      <header className="panel-header">
        <div className="stack gap-sm">
          <h2>{selectedUser.display_name}</h2>
          <p className="panel-copy">{selectedUser.email}</p>
        </div>
        <span className={`badge${selectedUser.is_active ? "" : " subtle"}`}>
          {selectedUser.is_active ? "Active" : "Inactive"}
        </span>
      </header>

      <nav className="project-tabs users-detail-tabs" aria-label="Selected user sections">
        {INSPECTOR_TABS.map((tab) => (
          <button
            aria-current={activeTab === tab.id ? "page" : undefined}
            className={`project-tab${activeTab === tab.id ? " is-active" : ""}`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "profile" ? (
        <div className="stack gap-md">
          {!canManageUsers ? (
            <div className="banner info">User profile editing requires the ManageUsers permission.</div>
          ) : null}
          {updateProfileMutation.isError ? <div className="banner error">{buildErrorMessage(updateProfileMutation.error)}</div> : null}
          {profileSuccess ? <div className="banner success">{profileSuccess}</div> : null}

          <label className="field">
            <span>Email</span>
            <input
              disabled={!canManageUsers || updateProfileMutation.isPending}
              value={profileEmail}
              onChange={(event) => {
                setProfileEmail(event.target.value);
                setProfileSuccess(null);
              }}
            />
          </label>
          <label className="field">
            <span>Display name</span>
            <input
              disabled={!canManageUsers || updateProfileMutation.isPending}
              value={profileDisplayName}
              onChange={(event) => {
                setProfileDisplayName(event.target.value);
                setProfileSuccess(null);
              }}
            />
          </label>
          <label className="checkbox-row">
            <input
              checked={profileIsActive}
              disabled={!canManageUsers || updateProfileMutation.isPending}
              onChange={(event) => {
                setProfileIsActive(event.target.checked);
                setProfileSuccess(null);
              }}
              type="checkbox"
            />
            <span>User is active</span>
          </label>

          <div className="action-row">
            <button
              className="button primary"
              disabled={!canManageUsers || !profileDirty || updateProfileMutation.isPending}
              onClick={saveProfile}
              type="button"
            >
              {updateProfileMutation.isPending ? "Saving..." : "Save changes"}
            </button>
            <button
              className="button ghost"
              disabled={!profileDirty || updateProfileMutation.isPending}
              onClick={() => {
                setProfileEmail(selectedUser.email);
                setProfileDisplayName(selectedUser.display_name);
                setProfileIsActive(selectedUser.is_active);
                setProfileSuccess(null);
              }}
              type="button"
            >
              Reset changes
            </button>
          </div>
        </div>
      ) : null}

      {activeTab === "permissions" ? (
        <div className="stack gap-md">
          {!canManagePermissions ? (
            <div className="banner info">Permission editing requires the ManagePermissions permission.</div>
          ) : null}
          {permissionsLoading ? <p className="muted">Loading permissions...</p> : null}
          <div className="users-inline-summary">
            <span className="muted">{`Selected: ${permissionsDraft.length} permissions`}</span>
          </div>

          {permissionGroups.grouped.map((group) => (
            <section className="permission-section-card" key={group.id}>
              <h3>{group.title}</h3>
              <div className="permission-option-list">
                {group.permissions.map((permission) => (
                  <PermissionCheckboxRow
                    checked={selectedPermissionSet.has(permission.code)}
                    disabled={!canManagePermissions || replacePermissionsMutation.isPending}
                    key={permission.id}
                    onChange={() => togglePermission(permission.code, setPermissionsDraft)}
                    permission={permission}
                  />
                ))}
              </div>
            </section>
          ))}

          <section className="permission-section-card">
            <h3>Environments</h3>
            <div className="environment-matrix">
              <div className="environment-matrix-header">
                <span />
                <span>All except production</span>
                <span>Production</span>
              </div>
              {permissionGroups.environmentPermissions.map((row) => (
                <div className="environment-matrix-row" key={row.rowLabel}>
                  <strong>{row.rowLabel}</strong>
                  {row.values.map((value) => {
                    if (!value.permission) {
                      return <span key={`${row.rowLabel}-${value.columnLabel}`} />;
                    }

                    const permission = value.permission;

                    return (
                      <label className="environment-matrix-cell" key={permission.code}>
                        <input
                          checked={selectedPermissionSet.has(permission.code)}
                          disabled={!canManagePermissions || replacePermissionsMutation.isPending}
                          onChange={() => togglePermission(permission.code, setPermissionsDraft)}
                          type="checkbox"
                        />
                        <span className="muted">{permission.code}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>

          {permissionGroups.otherPermissions.length > 0 ? (
            <section className="permission-section-card">
              <h3>Other permissions</h3>
              <div className="permission-option-list">
                {permissionGroups.otherPermissions.map((permission) => (
                  <PermissionCheckboxRow
                    checked={selectedPermissionSet.has(permission.code)}
                    disabled={!canManagePermissions || replacePermissionsMutation.isPending}
                    key={permission.id}
                    onChange={() => togglePermission(permission.code, setPermissionsDraft)}
                    permission={permission}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <div className="action-row permission-save-row">
            <button
              className="button primary"
              disabled={!canManagePermissions || !permissionsDirty || replacePermissionsMutation.isPending}
              onClick={savePermissions}
              type="button"
            >
              {replacePermissionsMutation.isPending ? "Saving..." : "Save permissions"}
            </button>
            <button
              className="button ghost"
              disabled={!permissionsDirty || replacePermissionsMutation.isPending}
              onClick={() => {
                setPermissionsDraft(userPermissions.map((permission) => permission.code));
                setPermissionsSuccess(null);
              }}
              type="button"
            >
              Reset changes
            </button>
            <span aria-live="polite" className="save-feedback-slot">
              {replacePermissionsMutation.isError ? (
                <span className="banner error inline-feedback" role="alert">
                  {buildErrorMessage(replacePermissionsMutation.error)}
                </span>
              ) : permissionsSuccess ? (
                <span className="banner success inline-feedback" role="status">
                  {permissionsSuccess}
                </span>
              ) : null}
            </span>
          </div>
        </div>
      ) : null}

      {activeTab === "project-access" ? (
        <div className="stack gap-md">
          {!canManageUsers ? (
            <div className="banner info">Project access management requires the ManageUsers permission.</div>
          ) : null}
          {addProjectAccessMutation.isError ? <div className="banner error">{buildErrorMessage(addProjectAccessMutation.error)}</div> : null}
          {removeProjectAccessMutation.isError ? <div className="banner error">{buildErrorMessage(removeProjectAccessMutation.error)}</div> : null}
          <div className="banner info">
            Direct permissions are global. Project access controls which projects this user can access. Project owners have implicit full access inside owned projects.
          </div>
          {projectAccessLoading ? <p className="muted">Loading project access...</p> : null}

          <section className="permission-section-card">
            <header className="panel-header">
              <div className="stack gap-sm">
                <h3>Access by project</h3>
                <p className="panel-copy">{`Visible projects in catalog: ${projectCatalogCount}`}</p>
              </div>
            </header>

            {projectAccess.length === 0 ? <p className="muted">No projects are available in the catalog.</p> : null}

            <div className="project-resource-list">
              {projectAccess.map((item) => (
                <div className="resource-item-card" key={item.project_id}>
                  <div className="stack gap-sm">
                    <strong>{item.project_name}</strong>
                    <span className="muted">{item.project_slug}</span>
                    <div className="action-row">
                      <span className={`badge relation-badge relation-${item.relation}`}>
                        {item.relation === "owner" ? "Owner" : item.relation === "member" ? "Member" : "No access"}
                      </span>
                      {item.access_added_at ? <span className="badge subtle">{item.access_added_at}</span> : null}
                    </div>
                    {item.relation === "owner" ? (
                      <p className="muted">Project owner access cannot be removed here.</p>
                    ) : item.relation === "member" ? (
                      <p className="muted">Membership grants access alongside the user's global direct permissions.</p>
                    ) : (
                      <p className="muted">No ownership or project membership.</p>
                    )}
                  </div>
                  {item.relation === "member" ? (
                    <button
                      className="button ghost danger"
                      disabled={!item.can_manage_access || removeProjectAccessMutation.isPending}
                      onClick={() => {
                        if (window.confirm(`Remove access to "${item.project_name}" for "${selectedUser.display_name}"?`)) {
                          removeProjectAccessMutation.mutate(item.project_slug);
                        }
                      }}
                      type="button"
                    >
                      Remove access
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="permission-section-card">
            <header className="panel-header">
              <div className="stack gap-sm">
                <h3>Add project access</h3>
                <p className="panel-copy">Grant membership access without mixing it into the current access list.</p>
              </div>
              {addableProjects.length > 0 && canManageUsers ? (
                <button
                  className="button primary"
                  onClick={() => setIsAddProjectAccessDialogOpen(true)}
                  type="button"
                >
                  Add project access
                </button>
              ) : null}
            </header>
            {addableProjects.length === 0 ? (
              <p className="muted">No manageable projects without access are available for this user.</p>
            ) : (
              <p className="muted">Use the modal to select one manageable project and add membership access.</p>
            )}
          </section>

          <AddProjectAccessDialog
            canManageUsers={canManageUsers}
            error={addProjectAccessMutation.error}
            isPending={addProjectAccessMutation.isPending}
            onChangeProjectSlug={setSelectedProjectSlugToAdd}
            onClose={() => {
              setIsAddProjectAccessDialogOpen(false);
              addProjectAccessMutation.reset();
            }}
            onSubmit={() => addProjectAccessMutation.mutate()}
            open={isAddProjectAccessDialogOpen}
            projects={addableProjects}
            selectedProjectSlug={selectedProjectSlugToAdd}
          />
        </div>
      ) : null}

      {activeTab === "security" ? (
        <div className="stack gap-md">
          {!canManageUsers ? (
            <div className="banner info">Security actions require the ManageUsers permission.</div>
          ) : null}
          {updatePasswordMutation.isError ? <div className="banner error">{buildErrorMessage(updatePasswordMutation.error)}</div> : null}
          {generateResetLinkMutation.isError ? <div className="banner error">{buildErrorMessage(generateResetLinkMutation.error)}</div> : null}
          {deleteUserMutation.isError ? <div className="banner error">{buildErrorMessage(deleteUserMutation.error)}</div> : null}
          {securitySuccess ? <div className="banner success">{securitySuccess}</div> : null}

          <section className="permission-section-card">
            <h3>Password</h3>
            <label className="field">
              <span>New password</span>
              <input
                disabled={!canManageUsers || updatePasswordMutation.isPending}
                type="password"
                value={securityPassword}
                onChange={(event) => {
                  setSecurityPassword(event.target.value);
                  setSecuritySuccess(null);
                }}
                placeholder="Leave blank to keep the current password."
              />
            </label>
            <p className="muted">Leave blank to keep the current password.</p>
            <div className="action-row">
              <button
                className="button secondary"
                disabled={!canManageUsers || !securityPassword.trim() || updatePasswordMutation.isPending}
                onClick={() => updatePasswordMutation.mutate()}
                type="button"
              >
                {updatePasswordMutation.isPending ? "Saving..." : "Save password"}
              </button>
            </div>
          </section>

          <section className="permission-section-card">
            <h3>Password reset</h3>
            <div className="action-row">
              <button
                className="button ghost"
                disabled={!canManageUsers || generateResetLinkMutation.isPending}
                onClick={() => generateResetLinkMutation.mutate()}
                type="button"
              >
                {generateResetLinkMutation.isPending ? "Generating..." : "Generate reset link"}
              </button>
            </div>
            {resetLink ? (
              <div className="banner info stack gap-sm">
                <strong>One-time reset link</strong>
                <span>This link is shown once and stays valid for 15 minutes.</span>
                <div className="reset-link-value-row">
                  <code className="inline-code-block">{resetLink.reset_url}</code>
                  <button className="button ghost" onClick={copyResetLink} type="button">
                    {resetLinkCopyState === "copied" ? <Check size={16} /> : <Copy size={16} />}
                    {resetLinkCopyState === "copied" ? "Copied" : "Copy link"}
                  </button>
                </div>
                <span>{`Expires at: ${resetLink.expires_at}`}</span>
                {resetLinkCopyState === "error" ? (
                  <span className="danger-text">Could not copy the link. Select it manually.</span>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="danger-box users-danger-box">
            <div className="stack gap-sm">
              <strong>Delete user</strong>
              <p className="muted">This permanently removes the user record and should stay separate from normal profile actions.</p>
            </div>
            <button
              className="button ghost danger"
              disabled={!canManageUsers || deleteUserMutation.isPending}
              onClick={() => {
                if (window.confirm(`Delete user "${selectedUser.display_name}"?`)) {
                  deleteUserMutation.mutate();
                }
              }}
              type="button"
            >
              {deleteUserMutation.isPending ? "Deleting..." : "Delete user"}
            </button>
          </section>
        </div>
      ) : null}
    </article>
  );
}

function AddProjectAccessDialog({
  open,
  projects,
  selectedProjectSlug,
  isPending,
  error,
  canManageUsers,
  onChangeProjectSlug,
  onClose,
  onSubmit,
}: {
  open: boolean;
  projects: UserProjectAccess[];
  selectedProjectSlug: string;
  isPending: boolean;
  error: unknown;
  canManageUsers: boolean;
  onChangeProjectSlug: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }

    if (!selectedProjectSlug && projects[0]) {
      onChangeProjectSlug(projects[0].project_slug);
    }
  }, [open, onChangeProjectSlug, projects, selectedProjectSlug]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="add-project-access-title">
      <div className="modal-card panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2 id="add-project-access-title">Add project access</h2>
            <p className="panel-copy">Grant project membership to the selected user without leaving the inspector.</p>
          </div>
          <button aria-label="Close add project access dialog" className="button ghost" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>

        {error ? <div className="banner error">{buildErrorMessage(error)}</div> : null}

        <label className="field">
          <span>Project</span>
          <select
            onChange={(event) => onChangeProjectSlug(event.target.value)}
            value={selectedProjectSlug}
          >
            {projects.map((item) => (
              <option key={item.project_id} value={item.project_slug}>
                {item.project_name}
              </option>
            ))}
          </select>
        </label>

        <div className="action-row">
          <button
            className="button primary"
            disabled={!canManageUsers || !selectedProjectSlug || isPending}
            onClick={onSubmit}
            type="button"
          >
            {isPending ? "Adding..." : "Add project access"}
          </button>
          <button className="button ghost" onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function PermissionCheckboxRow({
  permission,
  checked,
  disabled,
  onChange,
}: {
  permission: Permission;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <label className="permission-checkbox-row">
      <input checked={checked} disabled={disabled} onChange={onChange} type="checkbox" />
      <div className="stack gap-sm">
        <strong>{permission.code}</strong>
        {permission.description ? <span className="muted">{permission.description}</span> : null}
      </div>
    </label>
  );
}

function togglePermission(permissionCode: string, setCodes: Dispatch<SetStateAction<string[]>>) {
  setCodes((current) =>
    current.includes(permissionCode)
      ? current.filter((code) => code !== permissionCode)
      : [...current, permissionCode],
  );
}
