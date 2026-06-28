import { useQuery } from "@tanstack/react-query";
import { Namespace, apiGet, DeliveryManifest } from "../../api";
import { MetaRow } from "../../components/MetaRow";
import { useTranslation } from "../../i18n";

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
  const { t } = useTranslation();
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

  const namespaceJsonLinks = (namespacesQuery.data ?? [])
    .map((ns) => {
      const entry = deliveryManifestQuery.data?.namespaces?.find((n) => n.name === ns.name);
      return {
        id: ns.id,
        name: ns.name,
        href: entry ? `${origin}${entry.url}` : "",
      };
    })
    .filter((item) => item.href);

  return (
    <article className="panel stack gap-md">
      <header className="panel-header">
        <h2>{t("project.delivery.controls_title")}</h2>
      </header>
      <MetaRow label={t("project.delivery.languages")} value={String(languagesCount)} />
      <MetaRow label={t("project.delivery.namespaces")} value={String(namespacesCount)} />
      <MetaRow label={t("project.delivery.environments")} value={String(environmentsCount)} />
      <MetaRow label={t("project.delivery.current_environment")} value={environment || "—"} />
      <MetaRow label={t("project.delivery.current_language")} value={language || "—"} />

      <div className="divider" />
      <div className="stack gap-md">
        <header className="panel-header">
          <h2>{t("project.delivery.links_title")}</h2>
        </header>
        {localeBundleHref ? (
          <div className="link-card">
            <strong>{t("project.delivery.locale_bundle")}</strong>
            <a className="project-link" href={localeBundleHref} rel="noreferrer" target="_blank">
              {localeBundleHref}
            </a>
          </div>
        ) : (
          <p className="muted">{t("project.delivery.select_prompt")}</p>
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
