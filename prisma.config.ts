import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // Generation/build must not need a live database or production credentials.
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://campusone:campusone@localhost:5432/campusone' },
});
