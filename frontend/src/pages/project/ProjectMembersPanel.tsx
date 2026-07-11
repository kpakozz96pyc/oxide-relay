import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { ProjectMember, apiDelete, apiGet, apiPost, buildErrorMessage } from "../../api";

export function ProjectMembersPanel({
  projectSlug,
  canManageMembers,
  canViewMembers,
  projectOwnerId,
}: {
  projectSlug: string;
  canManageMembers: boolean;
  canViewMembers: boolean;
  projectOwnerId: string;
}) {
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [memberUserId, setMemberUserId] = useState("");

  const membersQuery = useQuery({
    queryKey: ["project", projectSlug, "members"],
    queryFn: () => apiGet<ProjectMember[]>(`/api/v1/projects/${projectSlug}/members`),
    enabled: Boolean(projectSlug) && canViewMembers,
  });

  const addMemberMutation = useMutation({
    mutationFn: async () =>
      apiPost(`/api/v1/projects/${projectSlug}/members`, {
        user_id: memberUserId,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "members"] });
      setIsCreateDialogOpen(false);
      setMemberUserId("");
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) =>
      apiDelete(`/api/v1/projects/${projectSlug}/members/${userId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "members"] });
    },
  });

  const members = membersQuery.data ?? [];
  const owner = members.find((member) => member.is_owner);

  if (!canViewMembers) {
    return (
      <article className="panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2>Access</h2>
            <p className="panel-copy">
              OxideRelay uses direct permissions with project membership and an owner override. Role presets are not part of the current MVP.
            </p>
          </div>
        </header>
        <MetaSummaryRow label="Owner" value={projectOwnerId} />
        <MetaSummaryRow label="Project members" value="Unavailable" />
        <MetaSummaryRow label="Access model" value="Direct permissions + project membership" />
        <div className="banner info">
          Member management is only visible to the project owner or users with the <code>ManageProjectMembers</code> permission.
        </div>
      </article>
    );
  }

  return (
    <div className="project-access-grid">
      <article className="panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2>Access Overview</h2>
            <p className="panel-copy">
              This project uses owner override, membership, and direct permissions. There are no Admin, Translator, or Read-only roles in the current product model.
            </p>
          </div>
        </header>
        <MetaSummaryRow
          label="Owner"
          value={owner ? `${owner.display_name} (${owner.email})` : projectOwnerId}
        />
        <MetaSummaryRow label="Project members" value={String(members.length)} />
        <MetaSummaryRow label="Access model" value="Direct permissions + project membership" />
      </article>

      <article className="panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2>Project Members</h2>
            <p className="panel-copy">
              Manage membership by user ID. The owner is always retained separately from regular members.
            </p>
          </div>
          <div className="action-row">
            <span className="badge">{members.length}</span>
            {canManageMembers ? (
              <button className="button primary" onClick={() => setIsCreateDialogOpen(true)} type="button">
                Add member
              </button>
            ) : null}
          </div>
        </header>

        {membersQuery.isLoading ? <p className="muted">Loading project members...</p> : null}
        {membersQuery.isError ? (
          <div className="banner error">{buildErrorMessage(membersQuery.error)}</div>
        ) : null}
        {addMemberMutation.isError ? (
          <div className="banner error">{buildErrorMessage(addMemberMutation.error)}</div>
        ) : null}
        {removeMemberMutation.isError ? (
          <div className="banner error">{buildErrorMessage(removeMemberMutation.error)}</div>
        ) : null}

        {canManageMembers ? (
          <p className="muted">Add members through a dedicated modal to keep the access workspace compact.</p>
        ) : (
          <div className="banner info">You can view members, but only the owner or a user with member-management permission can change them.</div>
        )}

        <div className="project-resource-list">
          {members.map((member) => (
            <div className="resource-item-card" key={member.id}>
              <div className="stack gap-sm">
                <strong>{member.display_name}</strong>
                <span className="muted">{member.email}</span>
                <div className="action-row">
                  {member.is_owner ? <span className="badge">Owner</span> : <span className="badge subtle">Project member</span>}
                  <span className="badge subtle">{member.is_active ? "Active" : "Inactive"}</span>
                </div>
              </div>
              {!member.is_owner ? (
                <button
                  className="button ghost danger"
                  disabled={removeMemberMutation.isPending || !canManageMembers}
                  onClick={() => {
                    if (window.confirm(`Remove "${member.display_name}" from this project?`)) {
                      removeMemberMutation.mutate(member.id);
                    }
                  }}
                  type="button"
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </article>

      <AddProjectMemberDialog
        canManageMembers={canManageMembers}
        error={addMemberMutation.error}
        isPending={addMemberMutation.isPending}
        onChangeUserId={setMemberUserId}
        onClose={() => {
          setIsCreateDialogOpen(false);
          addMemberMutation.reset();
        }}
        onSubmit={() => addMemberMutation.mutate()}
        open={isCreateDialogOpen}
        userId={memberUserId}
      />
    </div>
  );
}

function AddProjectMemberDialog({
  open,
  userId,
  isPending,
  error,
  canManageMembers,
  onChangeUserId,
  onClose,
  onSubmit,
}: {
  open: boolean;
  userId: string;
  isPending: boolean;
  error: unknown;
  canManageMembers: boolean;
  onChangeUserId: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  useEffect(() => {
    if (!open) {
      onChangeUserId("");
    }
  }, [open, onChangeUserId]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="add-project-member-title">
      <div className="modal-card panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2 id="add-project-member-title">Add member</h2>
            <p className="panel-copy">Grant project membership by user ID without leaving the current access workspace.</p>
          </div>
          <button aria-label="Close add member dialog" className="button ghost" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>

        {error ? <div className="banner error">{buildErrorMessage(error)}</div> : null}

        <label className="field">
          <span>User ID</span>
          <input
            onChange={(event) => onChangeUserId(event.target.value)}
            placeholder="Enter a user ID"
            value={userId}
          />
        </label>

        <div className="action-row">
          <button
            className="button primary"
            disabled={isPending || !canManageMembers || !userId.trim()}
            onClick={onSubmit}
            type="button"
          >
            {isPending ? "Adding..." : "Add member"}
          </button>
          <button className="button ghost" onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function MetaSummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
