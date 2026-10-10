import type { InstitutionalAuthMode } from "../../config.js";
import type { Prisma } from "../../generated/prisma/client.js";

type Account = {
  active: boolean;
  emailVerifiedAt: Date | null;
  email: string;
  isDemo: boolean;
};

// Domain eligibility does not establish mailbox ownership or institutional identity.
export function accountEligible<T extends Account>(account: T | null | undefined, mode: InstitutionalAuthMode = "email-verification", allowDemo = true): account is T {
  if (account && !allowDemo && (account.isDemo || account.email.split("@")[1] !== "ssn.edu.in")) return false;
  return !!account?.active && (!!account.emailVerifiedAt ||
    (mode === "domain-only-demo" && !account.isDemo && account.email.split("@")[1] === "ssn.edu.in"));
}

export function accountEligibilityWhere(mode: InstitutionalAuthMode = "email-verification", allowDemo = true): Prisma.UserWhereInput {
  return {
    active: true,
    ...(allowDemo ? {} : { isDemo: false, email: { endsWith: "@ssn.edu.in" } }),
    ...(mode === "domain-only-demo"
      ? { OR: [{ emailVerifiedAt: { not: null } }, { email: { endsWith: "@ssn.edu.in" }, isDemo: false }] }
      : { emailVerifiedAt: { not: null } }),
  };
}
