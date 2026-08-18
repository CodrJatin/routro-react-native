import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
  define: {
    // React Native's Metro transform injects this; vitest has no such global,
    // so any module branching on it throws a ReferenceError under test rather
    // than taking either branch. False, deliberately: a test should see what a
    // release build does, and the dev-only branches in this codebase exist to
    // stand things down (the mock friend fixture, the update checker), so
    // running them as production is both the honest reading and the one that
    // exercises real code.
    __DEV__: 'false',
  },
});
