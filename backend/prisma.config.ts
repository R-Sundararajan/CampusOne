import { config as loadEnv } from 'dotenv';
loadEnv({ path: ['.env', '../.env'], quiet: true });
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // Generation/build must not need a live database or production credentials.
  // Runtime uses DATABASE_URL (Neon pooled); CLI uses DIRECT_URL when supplied.
  datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://campusone:campusone@localhost:5432/campusone' },
});
