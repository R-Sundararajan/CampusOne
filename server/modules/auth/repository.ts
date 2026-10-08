import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Role } from '../../generated/prisma/enums.js';

export type PublicUser = { id: string; name: string; email: string; roles: Role[]; department: string };
export type LoginUser = PublicUser & { passwordHash: string };
export interface AuthRepository {
  findForLogin(email: string): Promise<LoginUser | null>;
  findActiveUser(id: string): Promise<PublicUser | null>;
}

const publicSelection = { id: true, name: true, email: true, roles: true, department: true } as const;

export function authRepository(db: PrismaClient): AuthRepository {
  return {
    findForLogin: email => db.user.findFirst({
      where: { email, active: true }, select: { ...publicSelection, passwordHash: true },
    }),
    findActiveUser: id => db.user.findFirst({ where: { id, active: true }, select: publicSelection }),
  };
}
