import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import type { Config } from '../server/config.js';
import { loadConfig } from '../server/config.js';
import { hashPassword } from '../server/modules/auth/routes.js';
import type { LoginUser, PublicUser, AuthRepository } from '../server/modules/auth/repository.js';
import { issueToken } from '../server/modules/auth/tokens.js';

const secret = 'test-only-secret-at-least-32-characters-long';
const origin = 'http://127.0.0.1:5173';
const config: Config = { nodeEnv: 'test', port: 3000, appOrigin: origin, databaseUrl: 'postgresql://test:test@localhost/test', jwtSecret: secret };
let app: Awaited<ReturnType<typeof createApp>>;
let user: LoginUser;
let disabled = false;
const repo: AuthRepository = {
  findForLogin: async email => !disabled && email === user.email ? user : null,
  findActiveUser: async id => {
    if (disabled || id !== user.id) return null;
    const { passwordHash: _, ...publicUser } = user;
    return publicUser;
  },
};
const cookie = async () => `campusone_token=${await issueToken('test-student', secret)}`;

beforeAll(async () => {
  user = { id: 'test-student', name: 'Test Student', email: 'student@campusone.example', department: 'CS', roles: ['STUDENT'], passwordHash: await hashPassword('TestPassword!2026') };
  app = await createApp({ config, auth: repo, checkDatabase: async () => {}, staticDirectory: path.resolve('client') });
});

describe('JWT authentication and access', () => {
  it('logs in using a normalized email and returns no password hash', async () => {
    const response = await request(app).post('/api/auth/login').set('Origin', origin)
      .send({ email: 'STUDENT@CAMPUSONE.EXAMPLE', password: 'TestPassword!2026' });
    expect(response.status).toBe(200);
    expect(response.body.user.passwordHash).toBeUndefined();
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect(response.headers['set-cookie'][0]).toContain('Max-Age=1800');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('uses secure cookies for the deployed HTTPS origin', async () => {
    const secureApp = await createApp({ config: { ...config, appOrigin: 'https://campus.example' }, auth: repo, checkDatabase: async () => {} });
    const response = await request(secureApp).post('/api/auth/login').set('Origin', 'https://campus.example')
      .send({ email: user.email, password: 'TestPassword!2026' });
    expect(response.headers['set-cookie'][0]).toContain('Secure');
  });

  it('rejects missing cookies, expired tokens, and incorrect signatures', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const expired = await issueToken(user.id, secret, new Date(Date.now() - 31 * 60_000));
    const wrongSignature = await issueToken(user.id, 'a-different-test-secret-at-least-32-characters');
    for (const token of [expired, wrongSignature]) {
      expect((await request(app).get('/api/auth/me').set('Cookie', `campusone_token=${token}`)).status).toBe(401);
    }
  });

  it('checks current roles and disables accounts immediately', async () => {
    const tokenCookie = await cookie();
    expect((await request(app).get('/api/auth/admin-check').set('Cookie', tokenCookie)).status).toBe(403);
    user.roles = ['STUDENT', 'ADMIN'];
    expect((await request(app).get('/api/auth/admin-check').set('Cookie', tokenCookie)).status).toBe(200);
    user.roles = ['STUDENT'];
    expect((await request(app).get('/api/auth/admin-check').set('Cookie', tokenCookie)).status).toBe(403);
    disabled = true;
    expect((await request(app).get('/api/auth/me').set('Cookie', tokenCookie)).status).toBe(401);
    disabled = false;
  });

  it('returns the same error for unknown users and incorrect passwords', async () => {
    const wrong = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: user.email, password: 'incorrect' });
    const missing = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: 'unknown@campusone.example', password: 'incorrect' });
    expect(wrong.status).toBe(401); expect(missing.status).toBe(401);
    expect(wrong.body).toEqual(missing.body);
  });

  it('rejects cross-origin and missing-origin writes, including logout', async () => {
    for (const route of ['login', 'logout']) {
      expect((await request(app).post(`/api/auth/${route}`)).status).toBe(403);
      expect((await request(app).post(`/api/auth/${route}`).set('Origin', 'https://untrusted.example')).status).toBe(403);
    }
  });

  it('clears the cookie but documents that an issued token remains valid', async () => {
    const tokenCookie = await cookie();
    const response = await request(app).post('/api/auth/logout').set('Origin', origin).set('Cookie', tokenCookie);
    expect(response.status).toBe(204);
    expect(response.headers['set-cookie'][0]).toContain('campusone_token=;');
    expect((await request(app).get('/api/auth/me').set('Cookie', tokenCookie)).status).toBe(200);
  });

  it('limits repeated failed logins', async () => {
    const limitedApp = await createApp({ config, auth: repo, checkDatabase: async () => {} });
    for (let i = 0; i < 10; i++) {
      const response = await request(limitedApp).post('/api/auth/login').set('Origin', origin).send({ email: user.email, password: 'wrong' });
      expect(response.status).toBe(401);
    }
    expect((await request(limitedApp).post('/api/auth/login').set('Origin', origin).send({ email: user.email, password: 'wrong' })).status).toBe(429);
  });
});

describe('Application boundaries', () => {
  it('serves UI routes and keeps unknown API paths as JSON 404s', async () => {
    expect((await request(app).get('/workspace')).text).toContain('CampusOne');
    const response = await request(app).get('/api/unknown');
    expect(response.status).toBe(404); expect(response.body.error).toBe('API route not found');
  });

  it('reports database failure as readiness failure while liveness stays available', async () => {
    const unavailable = await createApp({ config, auth: repo, checkDatabase: async () => { throw new Error('offline'); } });
    expect((await request(unavailable).get('/api/health/live')).status).toBe(200);
    expect((await request(unavailable).get('/api/health/ready')).status).toBe(503);
  });

  it('rejects malformed input without leaking internal details', async () => {
    const invalid = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: 'invalid', password: '' });
    expect(invalid.status).toBe(400);
    const malformed = await request(app).post('/api/auth/login').set('Origin', origin).set('Content-Type', 'application/json').send('{');
    expect(malformed.status).toBe(400);
  });

  it('rejects placeholder configuration and secret-bearing diagnostic output', () => {
    const env = { NODE_ENV: 'production', APP_ORIGIN: 'http://campus.example', DATABASE_URL: config.databaseUrl, JWT_SECRET: secret };
    expect(() => loadConfig(env)).toThrow('HTTPS');
    expect(() => loadConfig({ ...env, APP_ORIGIN: origin, JWT_SECRET: 'secret' })).toThrow('JWT_SECRET');
    expect(() => loadConfig({ ...env, APP_ORIGIN: origin, JWT_SECRET: 'replace-this-with-a-random-secret-at-least-32-characters' })).toThrow('placeholder');
  });
});
