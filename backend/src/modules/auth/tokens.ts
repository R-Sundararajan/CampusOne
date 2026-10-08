import { jwtVerify, SignJWT } from 'jose';

const issuer = 'campusone';
const audience = 'campusone-web';
export const tokenLifetimeSeconds = 30 * 60;

export async function issueToken(userId: string, secret: string, now = new Date()): Promise<string> {
  const seconds = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(issuer).setAudience(audience).setSubject(userId)
    .setIssuedAt(seconds).setExpirationTime(seconds + tokenLifetimeSeconds)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyToken(token: string, secret: string): Promise<string> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ['HS256'], issuer, audience, maxTokenAge: '30m',
  });
  if (!payload.sub) throw new Error('Missing token subject');
  return payload.sub;
}
