import { useQuery } from "@tanstack/react-query";
import { Namespace, apiGet, DeliveryManifest } from "../../api";
import { MetaRow } from "../../components/MetaRow";

export function ProjectDeliveryLinksPanel({
  projectSlug,
  environment,
  language,
  languagesCount,
  namespacesCount,
  environmentsCount,
}: {
  projectSlug: string;
  environment: string;
  language: string;
  languagesCount: number;
  namespacesCount: number;
  environmentsCount: number;
}) {
  const namespacesQuery = useQuery({
    queryKey: ["project", projectSlug, "namespaces"],
    queryFn: () => apiGet<Namespace[]>(`/api/v1/projects/${projectSlug}/namespaces`),
    enabled: Boolean(projectSlug),
  });

  const deliveryManifestQuery = useQuery({
    queryKey: ["project", projectSlug, "delivery-manifest", environment, language],
    queryFn: () =>
      apiGet<DeliveryManifest>(
        `/api/v1/projects/${projectSlug}/delivery-manifest/${encodeURIComponent(language)}?environment=${encodeURIComponent(environment)}`,
      ),
    enabled: Boolean(projectSlug && environment && language),
    retry: false,
  });

  const origin = window.location.origin;
  const localeBundleHref = deliveryManifestQuery.data?.locale_bundle_url
    ? `${origin}${deliveryManifestQuery.data.locale_bundle_url}`
    : null;

  const namespaceJsonLinks = (namespacesQuery.data ?? []).map((ns) => {
    const entry = deliveryManifestQuery.data?.namespaces?.find(n => n.name === ns.name);
    return {
      id: ns.id,
      name: ns.name,
      href: entry ? `${origin}${entry.url}` : "",
    };
  }).filter((item) => item.href);

  return (
    <article className="panel stack gap-md">
      <header className="panel-header">
        <h2>Project controls</h2>
      </header>
      <MetaRow label="Languages" value={String(languagesCount)} />
      <MetaRow label="Namespaces" value={String(namespacesCount)} />
      <MetaRow label="Environments" value={String(environmentsCount)} />
      <MetaRow label="Current environment" value={environment || "—"} />
      <MetaRow label="Current language" value={language || "—"} />
      
      <div className="divider" />
      <div className="stack gap-md">
        <header className="panel-header">
          <h2>Delivery links</h2>
        </header>
        {localeBundleHref ? (
          <div className="link-card">
            <strong>Locale bundle</strong>
            <a className="project-link" href={localeBundleHref} rel="noreferrer" target="_blank">
              {localeBundleHref}
            </a>
          </div>
        ) : (
          <p className="muted">Select environment and language to view delivery URLs.</p>
        )}
        {namespaceJsonLinks.length > 0 ? (
          <div className="link-list">
            {namespaceJsonLinks.map((item) => (
              <div className="link-card" key={item.id}>
                <strong>{item.name}.json</strong>
                <a className="project-link" href={item.href} rel="noreferrer" target="_blank">
                  {item.href}
                </a>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
