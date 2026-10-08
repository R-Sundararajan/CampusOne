import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

type Role = 'STUDENT' | 'STAFF' | 'CLUB_HEAD' | 'ADMIN';
type User = { id: string; name: string; email: string; roles: Role[]; department: string };
const roleNames: Record<Role, string> = { STUDENT: 'Student', STAFF: 'Faculty', CLUB_HEAD: 'Club Head', ADMIN: 'Administrator' };

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Something went wrong. Please try again.');
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

function Mark() {
  return <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M6 24V12l10-6 10 6v12M11 24v-8h10v8M3 25h26" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>;
}

function Icon({ kind }: { kind: 'attendance' | 'events' | 'complaints' }) {
  const paths = {
    attendance: <><path d="M8 3v4M16 3v4M4 10h16" /><rect x="4" y="5" width="16" height="16" rx="3" /><path d="m8 15 3 3 5-6" /></>,
    events: <><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9L12 3Z" /></>,
    complaints: <><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.8-4A8.5 8.5 0 1 1 21 11.5Z" /><path d="M8 11h8M8 14h5" /></>,
  };
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [activeRole, setActiveRole] = useState<Role>('STUDENT');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/me', { signal: controller.signal, credentials: 'same-origin' })
      .then(async response => {
        if (response.status === 401) return;
        if (!response.ok) throw new Error('Unable to check your login. Please try again.');
        const data = await response.json() as { user: User };
        setUser(data.user); setActiveRole(data.user.roles[0]);
      })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) });
      setUser(result.user); setActiveRole(result.user.roles[0]); setPassword('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to sign in.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true); setError('');
    try { await api<void>('/api/auth/logout', { method: 'POST' }); setUser(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to sign out.'); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="loading" role="status">Opening your campus…</main>;

  if (!user) return <main className="login-layout">
    <section className="intro">
      <div className="brand"><Mark />Campus<span>One</span></div>
      <div className="intro-content"><span className="eyebrow">A LITTLE LESS SCATTERED. A LOT MORE CONNECTED.</span>
        <h1>Your campus.<br />All in <em>one place.</em></h1>
        <p>Keep up with your classes, discover your next experience, and get help when you need it.</p>
        <div className="intro-features">
          <div><Icon kind="attendance" /><span>Attendance, at a glance</span></div>
          <div><Icon kind="events" /><span>Find your campus community</span></div>
          <div><Icon kind="complaints" /><span>A clearer way to raise concerns</span></div>
        </div>
      </div>
      <div className="intro-footer"><span>Built around campus life.</span><span>CampusOne / 2026</span></div>
      <div className="orbit orbit-one" aria-hidden="true" /><div className="orbit orbit-two" aria-hidden="true" />
    </section>
    <section className="signin">
      <div className="signin-content"><span className="small-label">YOUR CAMPUS WORKSPACE</span><h2>Welcome back.</h2><p className="muted">Sign in to your college account to get started.</p>
        <form onSubmit={login}>
          <label htmlFor="email">College email</label><input id="email" type="email" autoComplete="username" placeholder="you@college.edu" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} />
          <label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" placeholder="Enter your password" maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<span aria-hidden="true">→</span></button>
        </form>
        <div className="account-note"><span className="note-dot" />Accounts are provided by your campus administrator.</div>
        <div className="demo"><span className="small-label">DEMONSTRATION ACCOUNTS</span><p>Choose a role to fill its email. Use your configured demo password.</p><div className="demo-options">{(['student', 'staff', 'clubhead', 'admin'] as const).map(role => <button key={role} type="button" onClick={() => setEmail(`${role}@campusone.example`)}>{role === 'clubhead' ? 'Club Head' : role === 'staff' ? 'Faculty' : role[0].toUpperCase() + role.slice(1)}</button>)}</div></div>
      </div>
      <footer className="signin-footer">Attendance · Events · Campus support</footer>
    </section>
  </main>;

  const attendanceCopy = activeRole === 'STUDENT' || activeRole === 'CLUB_HEAD' ? 'See your subject attendance and keep track of your progress.' : 'Mark attendance for your assigned classes and review reports.';
  return <div className="workspace">
    <aside className="sidebar"><div className="brand"><Mark />Campus<span>One</span></div><div className="sidebar-label">WORKSPACE</div><div className="nav-active"><span aria-hidden="true">⌂</span> Overview</div><div className="sidebar-bottom"><span className="small-label">ONE CONNECTED CAMPUS</span><p>More clarity.<br />Less running around.</p></div></aside>
    <div className="workspace-main"><header className="topbar"><span>{user.department}</span><button className="text-button" onClick={logout} disabled={busy}>{busy ? 'Signing out…' : 'Sign out'} <span aria-hidden="true">↗</span></button></header>
      <main className="dashboard"><div className="page-heading"><div><span className="small-label">YOUR DAY, CONNECTED</span><h1>Hello, {user.name.split(' ')[0]}<span className="greeting-dot">.</span></h1><p className="muted">A single place for the things that matter on campus.</p></div><span className="role-badge">{roleNames[activeRole]}</span></div>
        {error && <p className="error" role="alert">{error}</p>}
        {user.roles.length > 1 && <div className="role-switch" aria-label="Workspace role">{user.roles.map(role => <button key={role} aria-pressed={activeRole === role} className={activeRole === role ? 'selected' : ''} onClick={() => setActiveRole(role)}>{roleNames[role]}</button>)}</div>}
        <section className="welcome-panel"><div><span className="eyebrow">WELCOME TO CAMPUSONE</span><h2>A good campus day<br />starts with a little clarity.</h2><p>Your account is ready. Your campus tools are taking shape.</p></div><div className="welcome-art" aria-hidden="true"><div className="art-ring"/><div className="art-building">C<span>1</span></div></div></section>
        <div className="section-heading"><h2>Your campus essentials</h2><span>Coming to your workspace</span></div>
        <section className="module-grid" aria-label="Campus modules">
          {([
            { kind: 'attendance' as const, number: '01', name: 'Attendance', copy: attendanceCopy, status: 'Next milestone' },
            { kind: 'events' as const, number: '02', name: 'Campus events', copy: activeRole === 'CLUB_HEAD' ? 'Create experiences for your club and manage registrations.' : 'Explore clubs, find upcoming events, and take part.', status: 'Coming soon' },
            { kind: 'complaints' as const, number: '03', name: 'Campus support', copy: activeRole === 'ADMIN' ? 'Review campus concerns and help bring them to resolution.' : 'Raise a concern and follow its progress in one place.', status: 'Coming soon' },
          ]).map(module => <article className={`module-card ${module.kind}`} key={module.kind}><div className="module-top"><span className="module-icon"><Icon kind={module.kind} /></span><span className="module-number">{module.number}</span></div><h3>{module.name}</h3><p>{module.copy}</p><div className="module-status"><span className="status-dot" />{module.status}</div></article>)}
        </section>
        <section className="profile-strip"><div className="avatar">{user.name.split(' ').slice(0, 2).map(part => part[0]).join('')}</div><div><strong>{user.name}</strong><span>{user.email}</span></div><span className="profile-roles">{user.roles.map(role => roleNames[role]).join(' · ')}</span></section>
        <footer className="dashboard-footer">CampusOne <span>Your campus, connected.</span></footer>
      </main>
    </div>
  </div>;
}
