import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectPage } from "./pages/ProjectPage";
import { UsersPage } from "./pages/UsersPage";
import { AppLayout } from "./components/AppLayout";
import { LoadingScreen } from "./components/LoadingScreen";
import { useSession } from "./hooks/useSession";
import { I18nProvider, useTranslation } from "./i18n";

export function App() {
  return (
    <I18nProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/projects/:projectSlug" element={<ProjectPage />} />
        </Route>
      </Routes>
    </I18nProvider>
  );
}

function RequireAuth() {
  const location = useLocation();
  const session = useSession();
  const { t } = useTranslation();

  if (session.isLoading) {
    return <LoadingScreen label={t("loading.session.restore")} />;
  }

  if (!session.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <AppLayout user={session.user} onLogout={session.logout}>
      <Outlet />
    </AppLayout>
  );
}
