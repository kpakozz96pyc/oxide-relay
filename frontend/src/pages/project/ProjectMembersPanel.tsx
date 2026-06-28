import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiDelete, buildErrorMessage, ProjectMember } from "../../api";
import { useTranslation } from "../../i18n";

export function ProjectMembersPanel({
  projectSlug,
  canManageMembers,
  canViewMembers,
}: {
  projectSlug: string;
  canManageMembers: boolean;
  canViewMembers: boolean;
}) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
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

  if (!canViewMembers) return null;

  return (
    <div className="stack gap-md">
      <header className="panel-header">
        <h2>{t("project.members.title")}</h2>
        <span className="badge">{membersQuery.data?.length ?? 0}</span>
      </header>
      <label className="field">
        <span>{t("project.members.add_by_id")}</span>
        <input
          value={memberUserId}
          onChange={(event) => setMemberUserId(event.target.value)}
          placeholder={t("project.members.add_placeholder")}
        />
      </label>
      <button
        className="button secondary"
        disabled={addMemberMutation.isPending || !canManageMembers || !memberUserId.trim()}
        onClick={() => addMemberMutation.mutate()}
      >
        {t("project.members.add")}
      </button>
      {membersQuery.isLoading ? <p className="muted">{t("project.members.loading")}</p> : null}
      {membersQuery.isError ? (
        <div className="banner error">{buildErrorMessage(membersQuery.error)}</div>
      ) : null}
      {addMemberMutation.isError ? (
        <div className="banner error">{buildErrorMessage(addMemberMutation.error)}</div>
      ) : null}
      {removeMemberMutation.isError ? (
        <div className="banner error">{buildErrorMessage(removeMemberMutation.error)}</div>
      ) : null}
      {membersQuery.data?.map((member) => (
        <div className="member-card" key={member.id}>
          <div className="stack gap-sm">
            <strong>{member.display_name}</strong>
            <span className="muted">{member.email}</span>
            <span className="badge subtle">
              {member.is_owner ? t("projects.badges.owner") : member.is_active ? t("users.badges.active") : t("users.badges.inactive")}
            </span>
          </div>
          {!member.is_owner ? (
            <button
              className="button ghost danger"
              disabled={removeMemberMutation.isPending || !canManageMembers}
              onClick={() => removeMemberMutation.mutate(member.id)}
            >
              {t("project.members.remove")}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
