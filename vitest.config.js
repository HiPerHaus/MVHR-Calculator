// vitest.config.js — HiPer Studio test configuration
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/engine/tests/**/*.test.js'],
    environment: 'node',
    // Pure ES module project — no transformation needed
    reporter: ['verbose'],
  },
});
