import { Link } from "./Link";
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="CampusOne home">
      <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true">
        <rect width="38" height="38" rx="8" fill="currentColor" />
        <path
          d="m8 14 11-6 11 6M10 29h18M12 17v9m7-9v9m7-9v9"
          fill="none"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      <span>
        Campus<span className="brand-one">One</span>
        <small>SSN CAMPUS · ACADEMIC PORTAL</small>
      </span>
    </Link>
  );
}
