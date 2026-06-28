import { useState, startTransition, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Globe, Lock, Layers, Users } from "lucide-react";
import { apiPost, buildErrorMessage, ApiError } from "../api";
import { useSession } from "../hooks/useSession";
import { useTranslation } from "../i18n";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useSession();
  const { language, setLanguage, supportedLanguages, t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | undefined)?.from ?? "/projects";

  const loginMutation = useMutation({
    mutationFn: async () =>
      apiPost("/api/v1/auth/login", { email, password }),
    onSuccess: async () => {
      await session.refresh();
      startTransition(() => navigate(from, { replace: true }));
    },
    onError: (loginError: ApiError) => {
      setError(buildErrorMessage(loginError));
    },
  });

  useEffect(() => {
    if (!session.isLoading && session.user) {
      navigate("/projects", { replace: true });
    }
  }, [navigate, session.isLoading, session.user]);

  return (
    <main className="login-shell">
      {/* Left: hero / branding */}
      <div className="login-hero">
        <div className="login-hero-content">
          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-4)", alignItems: "flex-start" }}>
            <p className="eyebrow">{t("app.name")}</p>
            <label className="field small" style={{ minWidth: 120 }}>
              <span>{t("layout.language.label")}</span>
              <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                {supportedLanguages.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <h1 className="login-hero-title">
            {t("login.hero.title.line1")}
            <br />
            {t("login.hero.title.line2")}
          </h1>
          <p className="login-hero-desc">
            {t("login.hero.description")}
          </p>

          <div className="login-hero-features">
            <div className="login-hero-feature">
              <div className="login-hero-feature-icon">
                <Globe size={16} />
              </div>
              <div>
                <strong>{t("login.features.delivery.title")}</strong>
                {t("login.features.delivery.description")}
              </div>
            </div>
            <div className="login-hero-feature">
              <div className="login-hero-feature-icon">
                <Layers size={16} />
              </div>
              <div>
                <strong>{t("login.features.namespaces.title")}</strong>
                {t("login.features.namespaces.description")}
              </div>
            </div>
            <div className="login-hero-feature">
              <div className="login-hero-feature-icon">
                <Users size={16} />
              </div>
              <div>
                <strong>{t("login.features.permissions.title")}</strong>
                {t("login.features.permissions.description")}
              </div>
            </div>
          </div>
        </div>

        <div className="login-hero-footer">
          {t("login.hero.footer")}
        </div>
      </div>

      {/* Right: form */}
      <div className="login-form-shell">
        <div className="login-form-inner">
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "var(--radius-md)",
              background: "var(--surface-raised)",
              border: "1px solid var(--border-strong)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--white)",
            }}
          >
            <Lock size={20} />
          </div>

          <h1 className="panel-title" style={{ marginTop: "var(--space-4)" }}>
            {t("login.form.title")}
          </h1>
          <p className="panel-copy" style={{ marginBottom: "var(--space-6)" }}>
            {t("login.form.description")}
          </p>

          <form
            className="stack gap-md"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              loginMutation.mutate();
            }}
          >
            <label className="field">
              <span>{t("login.form.email.label")}</span>
              <input
                type="email"
                value={email}
                autoComplete="email"
                placeholder={t("login.form.email.placeholder")}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="field">
              <span>{t("login.form.password.label")}</span>
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                placeholder={t("login.form.password.placeholder")}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error ? <div className="banner error">{error}</div> : null}
            <button className="button primary" disabled={loginMutation.isPending} type="submit">
              {loginMutation.isPending ? t("login.form.submit.pending") : t("login.form.submit.idle")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
