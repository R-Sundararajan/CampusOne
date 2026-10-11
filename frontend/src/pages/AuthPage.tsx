import { useEffect, useState, type FormEvent } from "react";
import { Brand } from "../components/Brand";
import { Link } from "../components/Link";
import { api, type User } from "../services/api";

export function AuthPage({
  route,
  onLogin,
}: {
  route: string;
  onLogin: (user: User) => void;
}) {
  const register = route === "/register";
  const verify = route === "/verify-email";
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [accountType, setAccountType] = useState("STUDENT");
  const [verified, setVerified] = useState(false);
  const [mode, setMode] = useState<string>();
  const demo = mode === "domain-only-demo";
  useEffect(() => {
    api<{ institutionalAuthMode: string }>("/auth/policy")
      .then((policy) => setMode(policy.institutionalAuthMode))
      .catch((e) => setError(e.message));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (register) {
        if (fields.password !== fields.confirmPassword)
          throw new Error("Passwords do not match.");
        const result = await api<{ message: string }>("/auth/register", fields);
        setMessage(result.message);
      } else {
        const result = await api<{ user: User }>("/auth/login", fields);
        onLogin(result.user);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
    setError("");
    try {
      await api("/auth/verification/resend", { email });
      setMessage(
        "If this account needs verification, a new link will be sent to its institutional inbox.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirmEmail() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ status: string }>("/auth/verify", { token });
      window.history.replaceState(null, "", "/verify-email");
      setVerified(true);
      setMessage(
        result.status === "ready"
          ? "Email verified. Your account is ready to use."
          : "Email verified. Your access request is awaiting Admin approval. Sign in after your request has been approved.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header auth-header">
        <div className="header-inner">
          <Brand />
          <span className="header-caption">Student & staff services</span>
        </div>
      </header>
      <main id="main" className="auth-main">
        <div className="auth-intro">
          <p className="eyebrow">WELCOME TO CAMPUSONE</p>
          <h1>Your campus, connected.</h1>
          <p>Attendance, club events and campus support in one place.</p>
        </div>
        <div className="auth-panel">
          <section className="auth-form-section">
            {!verify && (
              <nav className="auth-tabs" aria-label="Account access">
                <Link
                  href="/login"
                  aria-current={!register ? "page" : undefined}
                >
                  Sign in
                </Link>
                <Link
                  href="/register"
                  aria-current={register ? "page" : undefined}
                >
                  Create account
                </Link>
              </nav>
            )}
            <h2>
              {verify
                ? "Verify your email"
                : register
                  ? "Join your campus"
                  : "Sign in to CampusOne"}
            </h2>
            <p className="muted">
              {verify
                ? "Confirm that this institutional email belongs to you."
                : register
                  ? "Use your SSN institutional email to get started."
                  : "Enter your account details to continue."}
            </p>
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="notice success">
                {message}
              </p>
            )}
            {verify ? (
              <div className="verification-actions">
                {!verified && (
                  <button
                    className="primary-button"
                    disabled={busy || !token}
                    onClick={confirmEmail}
                  >
                    {busy ? "Verifying…" : "Confirm email address"}
                  </button>
                )}
                {!token && !verified && (
                  <p className="notice">
                    Open the complete verification link from your email, or
                    request a new one on the sign-in page.
                  </p>
                )}
                <Link href="/login">Return to sign in</Link>
              </div>
            ) : (
              <form onSubmit={submit}>
                {register && (
                  <label>
                    Full name
                    <input
                      name="fullName"
                      autoComplete="name"
                      required
                      minLength={2}
                      maxLength={100}
                      placeholder="Your full name"
                    />
                  </label>
                )}
                <label>
                  Institutional email
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@ssn.edu.in"
                  />
                </label>
                {register && (
                  <label>
                    Account type
                    <select
                      name="accountType"
                      value={accountType}
                      onChange={(e) => setAccountType(e.target.value)}
                    >
                      <option value="STUDENT">Student</option>
                      <option value="STAFF">Staff — approval required</option>
                      <option value="CLUB_HEAD">
                        Club Head — approval required
                      </option>
                    </select>
                    <small>
                      {demo
                        ? accountType === "STUDENT"
                          ? "Student access is ready after valid registration."
                          : "An Admin must verify your identity out of band and approve access and assignments."
                        : accountType === "STUDENT"
                        ? "Student access is activated after email verification."
                        : "Verify your email first. An Admin must approve your access and assignments."}
                    </small>
                  </label>
                )}
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    autoComplete={
                      register ? "new-password" : "current-password"
                    }
                    required
                    minLength={register ? 12 : 1}
                    maxLength={128}
                  />
                  {register && (
                    <small>
                      Use 12–128 characters. Choose a password unique to
                      CampusOne.
                    </small>
                  )}
                </label>
                {register && (
                  <label>
                    Confirm password
                    <input
                      name="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      maxLength={128}
                    />
                  </label>
                )}
                <button className="primary-button" disabled={busy}>
                  {busy
                    ? "Please wait…"
                    : register
                      ? "Create account"
                      : "Sign in"}
                </button>
                <p className="form-note">
                  CampusOne uses its own password. Your LMS password is not
                  required.
                </p>
              </form>
            )}
            {!verify && mode === "email-verification" && (
              <details className="verification-help">
                <summary>Waiting for a verification email?</summary>
                <p>
                  Enter your institutional email above, then request a new link.
                  Check your spam folder too.
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || !email}
                  onClick={resend}
                >
                  Resend verification link
                </button>
              </details>
            )}
          </section>
          <aside className="auth-aside">
            <span className="section-number">CAMPUS SERVICES</span>
            <h2>
              A place for your
              <br />
              everyday campus life.
            </h2>
            <div className="service-summary">
              <h3>Attendance</h3>
              <p>View your records and stay informed.</p>
              <h3>Events</h3>
              <p>Discover what’s happening across clubs.</p>
              <h3>Campus support</h3>
              <p>Raise concerns and follow their progress.</p>
            </div>
            <p className="aside-note">
              Use one account for your campus services. Staff and Club Head access requires Admin approval.
            </p>
            <div className="campus-lines" aria-hidden="true">
              <svg viewBox="0 0 300 80">
                <path d="M0 74h300M25 74V38l30-16 30 16v36M100 74V24l50-20 50 20v50M218 74V38l27-16 30 16v36M112 27h76M120 38v25m20-25v25m20-25v25m20-25v25M38 46v18m30-18v18m162-18v18m30-18v18" />
              </svg>
            </div>
          </aside>
        </div>
      </main>
      <footer className="site-footer">
        <span>CampusOne · SSN Campus, Chennai</span>
        <span>Institutional access · @ssn.edu.in</span>
      </footer>
    </>
  );
}
