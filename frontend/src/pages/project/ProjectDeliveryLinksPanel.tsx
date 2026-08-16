import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { DeliveryManifest, Environment, Language, Namespace, apiGet, buildErrorMessage } from "../../api";
import { MetaRow } from "../../components/MetaRow";

export function ProjectDeliveryLinksPanel({
  projectSlug,
  environments,
  languages,
  namespaces,
}: {
  projectSlug: string;
  environments: Environment[];
  languages: Language[];
  namespaces: Namespace[];
}) {
  const [environment, setEnvironment] = useState("");
  const [language, setLanguage] = useState("");

  useEffect(() => {
    if (!environment && environments[0]) {
      setEnvironment(environments[0].slug);
    }
  }, [environment, environments]);

  useEffect(() => {
    if (!language && languages[0]) {
      setLanguage(languages[0].code);
    }
  }, [language, languages]);

  const deliveryManifestPath = useMemo(() => {
    if (!projectSlug || !environment || !language) {
      return "";
    }

    return `/api/v1/projects/${projectSlug}/delivery-manifest/${encodeURIComponent(language)}?environment=${encodeURIComponent(environment)}`;
  }, [environment, language, projectSlug]);

  const deliveryManifestQuery = useQuery({
    queryKey: ["project", projectSlug, "delivery-manifest", environment, language],
    queryFn: () => apiGet<DeliveryManifest>(deliveryManifestPath),
    enabled: Boolean(deliveryManifestPath),
    retry: false,
  });

  const origin = window.location.origin;
  const localeBundleHref = deliveryManifestQuery.data?.locale_bundle_url
    ? buildUnversionedHref(origin, deliveryManifestQuery.data.locale_bundle_url)
    : null;
  const deliveryManifestHref = deliveryManifestPath ? `${origin}${deliveryManifestPath}` : null;
  const namespaceLinks = namespaces
    .map((namespaceItem) => {
      const manifestItem = deliveryManifestQuery.data?.namespaces.find(
        (entry) => entry.name === namespaceItem.name,
      );
      return manifestItem
        ? {
            id: namespaceItem.id,
            name: namespaceItem.name,
            href: buildUnversionedHref(origin, manifestItem.url),
            version: manifestItem.version,
          }
        : null;
    })
    .filter(
      (item): item is { id: string; name: string; href: string; version: string } => item !== null,
    );

  if (environments.length === 0 || languages.length === 0) {
    return null;
  }

  return (
    <section className="stack gap-md">
      <header className="panel-header">
        <div className="stack gap-sm">
          <h2>Delivery</h2>
          <p className="panel-copy">
            Real delivery endpoints are shown for the selected environment and language.
          </p>
        </div>
      </header>

      <div className="banner info stack gap-sm">
        <p>
          <strong>Stable URLs</strong> below omit the <code>v</code> parameter, so they always
          resolve to the current translations. They use short-lived caching and revalidation via
          <code> ETag</code> / <code>If-None-Match</code>.
        </p>
        <p>
          <strong>Content version</strong> is shown separately. Add it as <code>v=&lt;version&gt;</code>
          only when a client needs an immutable response tied to the current content; that URL
          becomes invalid after the translations change.
        </p>
        <p>
          These endpoints are public by default. A deployment can require an{" "}
          <code>Authorization: Bearer &lt;token&gt;</code> header instead; that token is a
          deployment-wide server setting and is never shown in this UI. See the README's{" "}
          <code>REST API</code> section for request examples covering both modes.
        </p>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Environment</span>
          <select value={environment} onChange={(event) => setEnvironment(event.target.value)}>
            {environments.map((item) => (
              <option key={item.id} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Language</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            {languages.map((item) => (
              <option key={item.id} value={item.code}>
                {item.code}
              </option>
            ))}
          </select>
        </label>
      </div>

      {deliveryManifestQuery.isError ? (
        <div className="banner error">{buildErrorMessage(deliveryManifestQuery.error)}</div>
      ) : null}

      {deliveryManifestQuery.isLoading ? (
        <p className="muted">Loading delivery endpoints...</p>
      ) : (
        <div className="project-link-list">
          <DeliveryLinkCard
            href={localeBundleHref}
            label="Locale bundle endpoint"
            description="Stable bundle URL that always resolves to the current translations."
            version={deliveryManifestQuery.data?.locale_bundle_version ?? null}
          />
          <DeliveryLinkCard
            href={deliveryManifestHref}
            label="Delivery manifest endpoint"
            description="Manifest response used by clients to discover namespace payloads."
            version={null}
          />
          {namespaceLinks.length > 0 ? (
            <div className="stack gap-sm">
              <span className="project-section-label">Namespace endpoints</span>
              <div className="project-link-list">
                {namespaceLinks.map((item) => (
                  <DeliveryLinkCard
                    key={item.id}
                    href={item.href}
                    label={`${item.name}.json`}
                    description="Stable namespace URL that always resolves to the current translations."
                    version={item.version}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="muted">No namespace delivery links are available for the current selection.</p>
          )}
        </div>
      )}
    </section>
  );
}

function DeliveryLinkCard({
  label,
  description,
  href,
  version,
}: {
  label: string;
  description: string;
  href: string | null;
  version: string | null;
}) {
  if (!href) {
    return null;
  }

  return (
    <div className="project-link-card">
      <div className="stack gap-sm">
        <strong>{label}</strong>
        <p className="muted">{description}</p>
        {version ? <MetaRow label="Content version" value={version} /> : null}
        <MetaRow
          label="Cache behavior"
          value="Short-lived (unversioned URL, revalidated via ETag)"
        />
        <a className="project-link" href={href} rel="noreferrer" target="_blank">
          <span>{href}</span>
          <ExternalLink size={14} />
        </a>
      </div>
    </div>
  );
}

function buildUnversionedHref(origin: string, deliveryPath: string): string {
  const url = new URL(deliveryPath, origin);
  url.searchParams.delete("v");
  return url.toString();
}
