// Unit tests must never reach a real API: any use of the global fetch fails the test.
import { beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Real network call attempted in a unit test");
  });
});
