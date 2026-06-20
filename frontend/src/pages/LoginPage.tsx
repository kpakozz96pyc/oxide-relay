import { useState, startTransition, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Globe, Lock, Layers, Users } from "lucide-react";
import { apiPost, buildErrorMessage, ApiError } from "../api";
import { useSession } from "../hooks/useSession";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useSession();
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
          <p className="eyebrow">OxideRelay</p>
          <h1 className="login-hero-title">
            Manage your&nbsp;
            <span>translations</span>
            <br />
            at&nbsp;scale.
          </h1>
          <p className="login-hero-desc">
            A session-backed admin console for managing translation keys,
            environments, and project members — all in one place.
          </p>

          <div className="login-hero-features">
            <div className="login-hero-feature">
              <div className="login-hero-feature-icon">
                <Globe size={16} />
              </div>
              <div>
                <strong>Multi-environment delivery</strong>
                Serve different translations per environment with static JSON endpoints.
              </div>
            </div>
            <div className="login-hero-feature">
              <div className="login-hero-feature-icon">
                <Layers size={16} />
              </div>
              <div>
                <strong>Namespaces & locales</strong>
                Organise keys by namespace and language, import JSON bundles in bulk.
              </div>
            </div>
            <div className="login-hero-feature">
              <div className="login-hero-feature-icon">
                <Users size={16} />
              </div>
              <div>
                <strong>Role-based access</strong>
                Fine-grained permissions per user across all projects.
              </div>
            </div>
          </div>
        </div>

        <div className="login-hero-footer">
          OxideRelay · Built with Rust &amp; React
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
              background: "var(--color-accent-subtle)",
              border: "1px solid var(--color-accent-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-accent)",
            }}
          >
            <Lock size={20} />
          </div>

          <h1 className="panel-title" style={{ marginTop: "var(--space-4)" }}>
            Sign in
          </h1>
          <p className="panel-copy" style={{ marginBottom: "var(--space-6)" }}>
            Access your workspace with an admin or project user account.
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
              <span>Email</span>
              <input
                type="email"
                value={email}
                autoComplete="email"
                placeholder="you@example.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                placeholder="••••••••"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error ? <div className="banner error">{error}</div> : null}
            <button className="button primary" disabled={loginMutation.isPending} type="submit">
              {loginMutation.isPending ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
