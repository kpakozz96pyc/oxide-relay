import { useDeferredValue, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { MemberCandidate, ProjectMember, apiDelete, apiGet, apiPost, buildErrorMessage } from "../../api";

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
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<MemberCandidate | null>(null);
  const deferredMemberSearch = useDeferredValue(memberSearch.trim());

  const membersQuery = useQuery({
    queryKey: ["project", projectSlug, "members"],
    queryFn: () => apiGet<ProjectMember[]>(`/api/v1/projects/${projectSlug}/members`),
    enabled: Boolean(projectSlug) && canViewMembers,
  });

  const memberCandidatesQuery = useQuery({
    queryKey: ["project", projectSlug, "member-candidates", deferredMemberSearch],
    queryFn: () =>
      apiGet<MemberCandidate[]>(
        `/api/v1/projects/${projectSlug}/members/search?q=${encodeURIComponent(deferredMemberSearch)}`,
      ),
    enabled: isCreateDialogOpen && canManageMembers && deferredMemberSearch.length > 0 && !selectedCandidate,
  });

  const addMemberMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCandidate) {
        throw new Error("Select a user before adding them.");
      }
      return apiPost(`/api/v1/projects/${projectSlug}/members`, {
        user_id: selectedCandidate.id,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "members"] });
      setIsCreateDialogOpen(false);
      setMemberSearch("");
      setSelectedCandidate(null);
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
              Search for a user by name or email to add them. The owner is always retained separately from regular members.
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
          <p className="muted">Search by name or email through a dedicated modal to keep the access workspace compact.</p>
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
        candidates={memberCandidatesQuery.data ?? []}
        candidatesError={memberCandidatesQuery.isError}
        candidatesLoading={memberCandidatesQuery.isFetching}
        canManageMembers={canManageMembers}
        error={addMemberMutation.error}
        isPending={addMemberMutation.isPending}
        onChangeSearch={(value) => {
          setMemberSearch(value);
          setSelectedCandidate(null);
        }}
        onClose={() => {
          setIsCreateDialogOpen(false);
          setMemberSearch("");
          setSelectedCandidate(null);
          addMemberMutation.reset();
        }}
        onSelectCandidate={setSelectedCandidate}
        onSubmit={() => addMemberMutation.mutate()}
        open={isCreateDialogOpen}
        search={memberSearch}
        selectedCandidate={selectedCandidate}
      />
    </div>
  );
}

function AddProjectMemberDialog({
  open,
  search,
  candidates,
  candidatesLoading,
  candidatesError,
  selectedCandidate,
  isPending,
  error,
  canManageMembers,
  onChangeSearch,
  onSelectCandidate,
  onClose,
  onSubmit,
}: {
  open: boolean;
  search: string;
  candidates: MemberCandidate[];
  candidatesLoading: boolean;
  candidatesError: boolean;
  selectedCandidate: MemberCandidate | null;
  isPending: boolean;
  error: unknown;
  canManageMembers: boolean;
  onChangeSearch: (value: string) => void;
  onSelectCandidate: (candidate: MemberCandidate | null) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  useEffect(() => {
    if (!open) {
      onChangeSearch("");
      onSelectCandidate(null);
    }
  }, [open, onChangeSearch, onSelectCandidate]);

  if (!open) {
    return null;
  }

  const trimmedSearch = search.trim();
  const showEmptyResultsHint =
    !candidatesLoading && !candidatesError && trimmedSearch.length > 0 && candidates.length === 0;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="add-project-member-title">
      <div className="modal-card panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2 id="add-project-member-title">Add member</h2>
            <p className="panel-copy">Search by name or email to grant project membership without leaving the current access workspace.</p>
          </div>
          <button aria-label="Close add member dialog" className="button ghost" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>

        {error ? <div className="banner error">{buildErrorMessage(error)}</div> : null}

        {selectedCandidate ? (
          <div className="member-candidate-selected">
            <div className="stack gap-sm">
              <strong>{selectedCandidate.display_name}</strong>
              <span className="muted">{selectedCandidate.email}</span>
            </div>
            <button className="button ghost" onClick={() => onSelectCandidate(null)} type="button">
              Change
            </button>
          </div>
        ) : (
          <>
            <label className="field">
              <span>Search by name or email</span>
              <input
                autoFocus
                onChange={(event) => onChangeSearch(event.target.value)}
                placeholder="e.g. Ada Lovelace or ada@example.com"
                value={search}
              />
            </label>

            {candidatesError ? (
              <div className="banner error">Unable to search for users right now.</div>
            ) : null}
            {candidatesLoading ? <p className="muted">Searching...</p> : null}
            {showEmptyResultsHint ? (
              <p className="muted">No eligible users match "{trimmedSearch}".</p>
            ) : null}
            {trimmedSearch.length === 0 ? (
              <p className="field-hint">Type at least one character to search for a user to add.</p>
            ) : null}

            {candidates.length > 0 ? (
              <ul className="member-candidate-list">
                {candidates.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      className="member-candidate-option"
                      onClick={() => onSelectCandidate(candidate)}
                      type="button"
                    >
                      <strong>{candidate.display_name}</strong>
                      <span className="muted">{candidate.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}

        <div className="action-row">
          <button
            className="button primary"
            disabled={isPending || !canManageMembers || !selectedCandidate}
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
