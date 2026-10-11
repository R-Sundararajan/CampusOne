import { defineConfig } from 'vitest/config';

// Database suites share the singleton image budget and five complaint group slots.
// Serialize files; concurrency inside each test still exercises real parallel requests.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', fileParallelism: false } });
