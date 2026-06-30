import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Lock } from "lucide-react";

import { apiPost, buildErrorMessage, type ApiError } from "../api";
import { useTranslation } from "../i18n";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const token = searchParams.get("token")?.trim() ?? "";

  const resetMutation = useMutation({
    mutationFn: async () =>
      apiPost<void>("/api/v1/auth/reset-password", {
        token,
        password,
      }),
    onSuccess: () => {
      setSuccess(true);
      setTimeout(() => navigate("/login", { replace: true }), 1200);
    },
    onError: (resetError: ApiError) => {
      setError(buildErrorMessage(resetError));
    },
  });

  const tokenMissing = token.length === 0;
  const passwordMismatch = password.length > 0 && confirmPassword.length > 0 && password !== confirmPassword;

  return (
    <main className="login-shell">
      <div className="login-hero">
        <div className="login-hero-content">
          <p className="eyebrow">{t("app.name")}</p>
          <h1 className="login-hero-title">
            {t("reset_password.title.line1")}
            <br />
            {t("reset_password.title.line2")}
          </h1>
          <p className="login-hero-desc">{t("reset_password.description")}</p>
        </div>
        <div className="login-hero-footer">
          <Link to="/login">{t("reset_password.back_to_login")}</Link>
        </div>
      </div>

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
            {t("reset_password.form.title")}
          </h1>
          <p className="panel-copy" style={{ marginBottom: "var(--space-6)" }}>
            {t("reset_password.form.description")}
          </p>

          {tokenMissing ? <div className="banner error">{t("reset_password.token_missing")}</div> : null}
          {success ? <div className="banner success">{t("reset_password.success")}</div> : null}

          <form
            className="stack gap-md"
            onSubmit={(event) => {
              event.preventDefault();
              if (tokenMissing || passwordMismatch) {
                return;
              }
              setError(null);
              resetMutation.mutate();
            }}
          >
            <label className="field">
              <span>{t("reset_password.password")}</span>
              <input
                type="password"
                value={password}
                autoComplete="new-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="field">
              <span>{t("reset_password.confirm_password")}</span>
              <input
                type="password"
                value={confirmPassword}
                autoComplete="new-password"
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            {passwordMismatch ? <div className="banner error">{t("reset_password.password_mismatch")}</div> : null}
            {error ? <div className="banner error">{error}</div> : null}
            <button
              className="button primary"
              disabled={tokenMissing || passwordMismatch || resetMutation.isPending || success}
              type="submit"
            >
              {resetMutation.isPending ? t("reset_password.pending") : t("reset_password.submit")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
