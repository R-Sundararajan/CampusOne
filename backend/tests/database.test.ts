import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { authRepository } from '../src/modules/auth/repository.js';
import { hashPassword } from '../src/modules/auth/routes.js';

// Opt in against a disposable/test database. Normal API tests need no database.
describe.skipIf(!process.env.TEST_DATABASE_URL)('PostgreSQL foundation', () => {
  const db = createDatabase(process.env.TEST_DATABASE_URL ?? 'postgresql://unused:unused@localhost/unused');
  const key = `test-${randomUUID()}`;
  const secret = 'database-test-only-secret-at-least-32-characters';
  const origin = 'http://127.0.0.1:5173';
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    await db.user.create({ data: { id: key, name: 'Database Test', email: `${key}@campusone.example`, passwordHash: await hashPassword('DatabaseTest!2026'), roles: ['STUDENT'], department: 'CS' } });
    app = await createApp({
      config: { nodeEnv: 'test', appOrigin: origin, port: 3000, databaseUrl: process.env.TEST_DATABASE_URL!, jwtSecret: secret },
      auth: authRepository(db), checkDatabase: async () => { await db.$queryRaw`SELECT 1`; },
    });
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { id: key } });
    await db.$disconnect();
  });

  it('authenticates with PostgreSQL and reflects account deactivation', async () => {
    const login = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: `${key}@campusone.example`, password: 'DatabaseTest!2026' });
    expect(login.status).toBe(200);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).body.user.id).toBe(key);
    expect((await request(app).get('/api/health/ready')).status).toBe(200);
    await db.user.update({ where: { id: key }, data: { active: false } });
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('enforces unique attendance and rolls back a failed transaction', async () => {
    await expect(db.$transaction(async tx => {
      await tx.classGroup.create({ data: { id: key, name: key, section: 'A', academicYear: '2026' } });
      await tx.subject.create({ data: { id: key, code: key, name: 'Test' } });
      await tx.courseOffering.create({ data: { id: key, classGroupId: key, subjectId: key } });
      const data = { offeringId: key, date: new Date('2026-10-08T00:00:00Z'), period: 1, markedById: key };
      await tx.attendanceSession.create({ data });
      await tx.attendanceSession.create({ data });
    })).rejects.toMatchObject({ code: 'P2002' });
    expect(await db.classGroup.findUnique({ where: { id: key } })).toBeNull();
    expect(await db.attendanceSession.count({ where: { offeringId: key } })).toBe(0);
  });

  it('enforces unique student/event registrations', async () => {
    await expect(db.$transaction(async tx => {
      await tx.club.create({ data: { id: key, name: key } });
      await tx.event.create({ data: { id: key, name: 'Test Event', description: 'Test', venue: 'Hall', startsAt: new Date('2026-12-01'), registrationEndsAt: new Date('2026-11-30'), clubId: key, creatorId: key } });
      await tx.eventRegistration.create({ data: { eventId: key, studentId: key } });
      await tx.eventRegistration.create({ data: { eventId: key, studentId: key } });
    })).rejects.toMatchObject({ code: 'P2002' });
    expect(await db.club.findUnique({ where: { id: key } })).toBeNull();
  });
});
