import { UserSummary } from "../../api";

export function UsersTable({
  users,
  projectFilter,
  selectedUserId,
  onSelect,
}: {
  users: UserSummary[];
  projectFilter: string | null;
  selectedUserId: string;
  onSelect: (userId: string) => void;
}) {
  if (users.length === 0) {
    return (
      <div className="users-empty-state">
        <strong>No users match the current filters.</strong>
        <p className="muted">Try clearing search or adjusting the active filters.</p>
      </div>
    );
  }

  return (
    <div className="table-shell users-table-shell">
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Status</th>
            <th>Projects</th>
            <th>Permissions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const isSelected = user.id === selectedUserId;
            return (
              <tr
                className={isSelected ? "users-table-row is-selected" : "users-table-row"}
                key={user.id}
                onClick={() => onSelect(user.id)}
              >
                <td>
                  <div className="stack gap-sm">
                    <strong>{user.display_name}</strong>
                    <span className="muted">{user.email}</span>
                  </div>
                </td>
                <td>
                  <span className={`badge${user.is_active ? "" : " subtle"}`}>
                    {user.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  {projectFilter && projectFilter !== "all" ? (
                    <span className="badge subtle">
                      {user.selected_project_relation === "owner"
                        ? "Owner"
                        : user.selected_project_relation === "member"
                          ? "Member"
                          : "No access"}
                    </span>
                  ) : (
                    <span>{user.project_access_count}</span>
                  )}
                </td>
                <td>{user.direct_permissions_count}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
