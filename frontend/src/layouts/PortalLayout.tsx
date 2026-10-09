import type { ReactNode } from "react";
import { Brand } from "../components/Brand";
import { Link } from "../components/Link";
import { roleLabel, type User } from "../services/api";
export function PortalLayout({
  user,
  route,
  onLogout,
  children,
}: {
  user: User;
  route: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  const links = [
    ["/", "Home"],
    ...(user.roles.some((r) => ["STUDENT", "STAFF", "ADMIN"].includes(r))
      ? [["/attendance", "Attendance"]]
      : []),
    ["/events", "Events"],
    ["/complaints", "Complaints"],
    ...(user.roles.includes("ADMIN") ? [["/approvals", "Approvals"]] : []),
  ];
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <div className="account-tools">
            <Link
              href="/profile"
              className="account-link"
              aria-label="Profile and access"
            >
              <span className="avatar" aria-hidden="true">
                {user.name
                  .split(" ")
                  .map((s) => s[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span>
                {user.name}
                <small>{user.roles.map((r) => roleLabel[r]).join(" · ")}</small>
              </span>
            </Link>
            <button className="text-button" onClick={onLogout}>
              Sign out
            </button>
          </div>
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          {links.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={
                route === href || (href !== "/" && route.startsWith(href + "/"))
                  ? "page"
                  : undefined
              }
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main id="main" className="portal-main">
        {children}
      </main>
      <footer className="site-footer">
        <span>CampusOne · SSN Campus, Chennai</span>
        <span>Academic project · Campus services</span>
      </footer>
    </>
  );
}
