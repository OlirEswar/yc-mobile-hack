/// <reference types="vite/client" />
/** Every Convex module, for convex-test. Import this in each backend test. */
export const modules = import.meta.glob(['./**/*.ts', './**/*.js', '!./**/*.test.ts', '!./**/*.d.ts', '!./test.setup.ts']);
