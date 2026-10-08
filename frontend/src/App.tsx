import { useEffect, useState } from "react";
import { api, type User } from "./services/api";
import { navigate, useRoute } from "./hooks/useRoute";
import { PortalLayout } from "./layouts/PortalLayout";
import { AuthPage } from "./pages/AuthPage";
import { Dashboard } from "./pages/Dashboard";
import { Profile } from "./pages/Profile";
import { Approvals } from "./pages/Approvals";

export default function App() {
  const route = useRoute();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ user: User }>("/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  async function logout() {
    try {
      await api("/auth/logout", {});
      setUser(null);
      navigate("/login");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (loading)
    return (
      <div className="loading" role="status">
        Opening CampusOne…
      </div>
    );
  if (!user || route === "/verify-email")
    return (
      <AuthPage
        key={route}
        route={route}
        onLogin={(value) => {
          setUser(value);
          navigate("/");
        }}
      />
    );
  return (
    <PortalLayout user={user} route={route} onLogout={logout}>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {route === "/profile" ? (
        <Profile user={user} />
      ) : route === "/approvals" && user.roles.includes("ADMIN") ? (
        <Approvals />
      ) : (
        <Dashboard user={user} route={route} />
      )}
    </PortalLayout>
  );
}
