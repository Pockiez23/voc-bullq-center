import { describe, it, expect } from "bun:test";

describe("env config", () => {
  it("uses PORT from process.env when provided", async () => {
    const originalPort = process.env.PORT;
    process.env.PORT = "4000";

    // Dynamic import to evaluate with current env
    const { env } = await import("../src/config/env");

    expect(env.port).toBe(4000);

    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
  });
});

