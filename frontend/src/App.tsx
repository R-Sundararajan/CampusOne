import { useEffect, useState } from "react";
import { api, sessionExpiredEvent, type User } from "./services/api";
import { navigate, useRoute } from "./hooks/useRoute";
import { PortalLayout } from "./layouts/PortalLayout";
import { AuthPage } from "./pages/AuthPage";
import { Dashboard } from "./pages/Dashboard";
import { Profile } from "./pages/Profile";
import { Approvals } from "./pages/Approvals";
import { Attendance } from "./pages/Attendance";

import { Events } from "./pages/Events";
import { Complaints } from "./pages/Complaints";

export default function App() {
  const route = useRoute();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sessionMessage, setSessionMessage] = useState("");
  useEffect(() => {
    const expired = () => {
      setUser(null);
      setSessionMessage("Your session has ended. Please sign in again.");
      navigate("/login");
    };
    window.addEventListener(sessionExpiredEvent, expired);
    return () => window.removeEventListener(sessionExpiredEvent, expired);
  }, []);
  useEffect(() => {
    api<{ user: User }>("/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  async function logout() {
    try {
      await api("/auth/logout", {});
      setSessionMessage("");
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
      <>
        {sessionMessage && <p role="status" className="notice">{sessionMessage}</p>}
        <AuthPage
          key={route}
          route={route}
          onLogin={(value) => {
            setSessionMessage("");
            setError("");
            setUser(value);
            navigate("/");
          }}
        />
      </>
    );
  return (
    <PortalLayout user={user} route={route} onLogout={logout}>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {route === "/events" || route.startsWith("/events/") ? (
        <Events key={route} user={user} route={route} />
      ) : route === "/complaints" || route.startsWith("/complaints/") ? (
        <Complaints key={route} route={route} />
      ) : route === "/attendance" ? (
        <Attendance user={user} />
      ) : route === "/profile" ? (
        <Profile user={user} />
      ) : route === "/approvals" && user.roles.includes("ADMIN") ? (
        <Approvals />
      ) : (
        <Dashboard user={user} route={route} />
      )}
    </PortalLayout>
  );
}
