import { describe, expect, it } from "vitest";
import {
  buildRateLimitPayload,
  formatRetryHint,
  isRateLimitPayload,
} from "@/lib/rate-limit";

describe("formatRetryHint", () => {
  it("uses a generic minute hint when retry time is unknown", () => {
    expect(formatRetryHint()).toBe("Please try again in about a minute.");
  });

  it("formats seconds for short waits", () => {
    expect(formatRetryHint(1)).toBe("Please try again in about 1 second.");
    expect(formatRetryHint(45)).toBe("Please try again in about 45 seconds.");
  });

  it("formats minutes for longer waits", () => {
    expect(formatRetryHint(60)).toBe("Please try again in about 1 minute.");
    expect(formatRetryHint(125)).toBe("Please try again in about 3 minutes.");
  });
});

describe("buildRateLimitPayload", () => {
  it("returns friendly chat copy with retry timing", () => {
    const payload = buildRateLimitPayload("chat", 30_000);

    expect(payload.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(payload.title).toContain("quickly");
    expect(payload.message).toContain("30 seconds");
    expect(payload.retryAfterSeconds).toBe(30);
  });

  it("returns friendly sync copy", () => {
    const payload = buildRateLimitPayload("sync", 90_000);

    expect(payload.title).toContain("Sync");
    expect(payload.message).toContain("2 minutes");
  });
});

describe("isRateLimitPayload", () => {
  it("detects structured rate limit responses", () => {
    expect(
      isRateLimitPayload({
        code: "RATE_LIMIT_EXCEEDED",
        error: "Rate limit exceeded.",
        title: "Slow down",
        message: "Try again soon.",
      }),
    ).toBe(true);
  });

  it("rejects unrelated payloads", () => {
    expect(isRateLimitPayload({ error: "Rate limit exceeded." })).toBe(false);
  });
});
