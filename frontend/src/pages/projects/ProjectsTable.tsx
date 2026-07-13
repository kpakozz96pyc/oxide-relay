import { useNavigate } from "react-router-dom";
import { Project } from "../../api";

export function ProjectsTable({ projects }: { projects: Project[] }) {
  const navigate = useNavigate();

  if (projects.length === 0) {
    return (
      <div className="projects-empty-state">
        <strong>No projects are available.</strong>
        <p className="muted">Create a project or ask its owner to grant you project access.</p>
      </div>
    );
  }

  return (
    <div className="table-shell projects-table-shell">
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Access</th>
            <th>Slug</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr
              className="projects-table-row"
              key={project.id}
              onClick={() => navigate(`/projects/${project.slug}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  navigate(`/projects/${project.slug}`);
                }
              }}
              role="link"
              tabIndex={0}
            >
              <td>
                <div className="stack gap-sm">
                  <strong className="project-link">{project.name}</strong>
                  <span className="muted">{project.description ?? "No description provided."}</span>
                </div>
              </td>
              <td>
                <span className="badge subtle">{project.is_owner ? "Owner" : "Member"}</span>
              </td>
              <td>{project.slug}</td>
              <td>{formatShortDate(project.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}
