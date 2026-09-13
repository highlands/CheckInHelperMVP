export type RateLimitKind = "chat" | "sync";

export type RateLimitPayload = {
  code: "RATE_LIMIT_EXCEEDED";
  error: string;
  title: string;
  message: string;
  retryAfterSeconds?: number;
};

export function isRateLimitPayload(data: unknown): data is RateLimitPayload {
  return (
    typeof data === "object" &&
    data !== null &&
    "code" in data &&
    (data as RateLimitPayload).code === "RATE_LIMIT_EXCEEDED"
  );
}

export function formatRetryHint(retryAfterSeconds?: number): string {
  if (!retryAfterSeconds || retryAfterSeconds <= 0) {
    return "Please try again in about a minute.";
  }

  if (retryAfterSeconds >= 60) {
    const minutes = Math.ceil(retryAfterSeconds / 60);
    return `Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }

  return `Please try again in about ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`;
}

export function buildRateLimitPayload(
  kind: RateLimitKind,
  retryAfterMs?: number,
): RateLimitPayload {
  const retryAfterSeconds = retryAfterMs
    ? Math.max(1, Math.ceil(retryAfterMs / 1000))
    : undefined;
  const retryHint = formatRetryHint(retryAfterSeconds);

  const copy = {
    chat: {
      title: "You're asking questions quickly",
      message: `Helper needs a short breather to keep answers reliable for everyone. ${retryHint}`,
    },
    sync: {
      title: "Sync needs a moment",
      message: `To protect the system, documentation sync can only run so often. ${retryHint}`,
    },
  }[kind];

  return {
    code: "RATE_LIMIT_EXCEEDED",
    error: "Rate limit exceeded.",
    title: copy.title,
    message: copy.message,
    retryAfterSeconds,
  };
}

export function rateLimitResponseHeaders(
  retryAfterSeconds?: number,
): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (retryAfterSeconds) {
    headers["Retry-After"] = String(retryAfterSeconds);
  }
  return headers;
}

export function createRateLimitResponse(
  kind: RateLimitKind,
  retryAfterMs?: number,
): Response {
  const payload = buildRateLimitPayload(kind, retryAfterMs);
  return new Response(JSON.stringify(payload), {
    status: 429,
    headers: rateLimitResponseHeaders(payload.retryAfterSeconds),
  });
}
