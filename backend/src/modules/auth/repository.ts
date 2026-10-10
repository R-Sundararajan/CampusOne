import type { PrismaClient } from "../../generated/prisma/client.js";
import type { Role } from "../../generated/prisma/enums.js";
import type { InstitutionalAuthMode } from "../../config.js";
import { accountEligibilityWhere } from "./account-policy.js";

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  department: string;
};
export type LoginUser = PublicUser & { passwordHash: string };
export interface AuthRepository {
  findForLogin(email: string): Promise<LoginUser | null>;
  findActiveUser(id: string): Promise<PublicUser | null>;
}

const publicSelection = {
  id: true,
  name: true,
  email: true,
  roles: true,
  department: true,
} as const;

export function authRepository(
  db: PrismaClient,
  allowDemo = false,
  mode: InstitutionalAuthMode = "email-verification",
): AuthRepository {
  const allowed = {
    ...accountEligibilityWhere(mode),
    roles: { isEmpty: false },
    ...(allowDemo ? {} : { isDemo: false, email: { endsWith: "@ssn.edu.in" } }),
  };
  return {
    findForLogin: (email) =>
      db.user.findFirst({
        where: { AND: [allowed, { email }] },
        select: { ...publicSelection, passwordHash: true },
      }),
    findActiveUser: (id) =>
      db.user.findFirst({ where: { ...allowed, id }, select: publicSelection }),
  };
}
