"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowUpRight,
  Check,
  Loader2,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import { SUGGESTED_PROMPTS } from "@/lib/assistant/prompts";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { MarkdownContent } from "@/components/chat/markdown-content";
import type { CitationView } from "@/components/chat/citation-card";
import { ComposerActionIcon } from "@/components/chat/composer-action-icon";
import { useRateLimitDialog } from "@/components/use-rate-limit-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ChatMessage = {
  id: string;
  /** Stable across server id swaps so mount entrance does not replay. */
  stableKey: string;
  role: "user" | "assistant";
  content: string;
  citations?: CitationView[];
};

export function ChatExperience({
  initialConversationId,
  embedded = false,
}: {
  initialConversationId?: string;
  embedded?: boolean;
}) {
  const [conversationId, setConversationId] = useState<string | undefined>(
    initialConversationId,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [feedbackByMessage, setFeedbackByMessage] = useState<
    Record<string, "confirming" | "leaving" | "hidden">
  >({});
  const feedbackHideTimers = useRef<Record<string, number[]>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { handleRateLimitResponse, rateLimitDialog } = useRateLimitDialog();

  const hasInput = input.trim().length > 0;

  function resizeComposer() {
    const el = textareaRef.current;
    if (!el) return;
    // Match the 40px send button on a single line so items-end is visually centered.
    el.style.height = "40px";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 40), 160)}px`;
  }

  useEffect(() => {
    const timers = feedbackHideTimers.current;
    return () => {
      Object.values(timers).forEach((ids) =>
        ids.forEach((id) => window.clearTimeout(id)),
      );
    };
  }, []);

  useEffect(() => {
    resizeComposer();
  }, [input]);

  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    bottomRef.current?.scrollIntoView({
      behavior: reduce || isStreaming ? "auto" : "smooth",
    });
  }, [messages, status, isStreaming]);

  function clearFeedbackTimers(messageId?: string) {
    if (messageId) {
      (feedbackHideTimers.current[messageId] ?? []).forEach((id) =>
        window.clearTimeout(id),
      );
      delete feedbackHideTimers.current[messageId];
      return;
    }
    Object.values(feedbackHideTimers.current).forEach((ids) =>
      ids.forEach((id) => window.clearTimeout(id)),
    );
    feedbackHideTimers.current = {};
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    setIsStreaming(true);
    setStatus("Sending your question…");

    const userKey = `local-user-${Date.now()}`;
    const userMessage: ChatMessage = {
      id: userKey,
      stableKey: userKey,
      role: "user",
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    const assistantId = `local-assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        stableKey: assistantId,
        role: "assistant",
        content: "",
        citations: [],
      },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: trimmed }),
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string; traceId?: string; code?: string; title?: string; message?: string }
          | null;

        if (handleRateLimitResponse(response, payload)) {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          return;
        }

        throw new Error(
          payload?.traceId
            ? `${payload.error ?? "Unable to reach the assistant."} Reference: ${payload.traceId}`
            : (payload?.error ?? "Unable to reach the assistant."),
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const payload = JSON.parse(line.slice(5).trim()) as {
            type: string;
            conversationId?: string;
            text?: string;
            status?: string;
            message?: string;
            citations?: CitationView[];
            messageId?: string;
          };

          if (payload.type === "conversation" && payload.conversationId) {
            setConversationId(payload.conversationId);
          } else if (payload.type === "status" && payload.status) {
            setStatus(
              payload.status === "retrieving"
                ? "Searching approved documentation…"
                : payload.status === "generating"
                  ? "Preparing your answer…"
                  : null,
            );
          } else if (payload.type === "delta" && payload.text) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + payload.text }
                  : m,
              ),
            );
          } else if (payload.type === "completed") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                    ...m,
                    content: payload.text ?? m.content,
                    citations: payload.citations ?? [],
                    id: payload.messageId ?? assistantId,
                  }
                  : m,
              ),
            );
          } else if (payload.type === "saved") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                    ...m,
                    id: payload.messageId ?? assistantId,
                    citations: payload.citations ?? m.citations,
                  }
                  : m,
              ),
            );
          } else if (payload.type === "error") {
            toast.error(payload.message ?? "Something went wrong.");
          }
        }
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Something went wrong.",
      );
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setIsStreaming(false);
      setStatus(null);
    }
  }

  async function submitFeedback(
    messageId: string,
    helpful: "HELPFUL" | "NOT_HELPFUL" | "INCORRECT",
  ) {
    if (!conversationId || feedbackByMessage[messageId]) return;

    setFeedbackByMessage((prev) => ({ ...prev, [messageId]: "confirming" }));

    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          messageId,
          helpful,
          suggestsDocumentationGap: helpful !== "HELPFUL",
        }),
      });
    } catch {
      // Keep the confirmation UI even if the request fails so the row still clears.
    }

    clearFeedbackTimers(messageId);
    const leaveId = window.setTimeout(() => {
      setFeedbackByMessage((prev) => ({ ...prev, [messageId]: "leaving" }));
    }, 900);
    const hideId = window.setTimeout(() => {
      setFeedbackByMessage((prev) => ({ ...prev, [messageId]: "hidden" }));
      delete feedbackHideTimers.current[messageId];
    }, 1100);
    feedbackHideTimers.current[messageId] = [leaveId, hideId];
  }

  function startNewConversation() {
    clearFeedbackTimers();
    setConversationId(undefined);
    setMessages([]);
    setFeedbackByMessage({});
  }

  const showEmptyState = messages.length === 0;

  const thread = (
    <>
      {showEmptyState ? (
        <div className="mt-auto w-full pb-2">
          <div className="gradient-panel rounded-[1.75rem] p-6 shadow-[var(--shadow-soft)] md:p-8">
            <h3 className="text-3xl font-bold tracking-tight text-[#0B2749] md:text-4xl dark:text-[var(--color-foreground)]">
              How can I help?
            </h3>
            <p className="mt-2 max-w-xl text-sm text-[var(--color-muted)]">
              Pick a starter question or type your own below.
            </p>
            <div className="mt-5 grid auto-rows-fr gap-3 sm:grid-cols-2">
              {SUGGESTED_PROMPTS.map((prompt, index) => (
                <div
                  key={prompt}
                  className="suggested-prompt-enter h-full"
                  style={
                    {
                      "--stagger-index": index,
                    } as CSSProperties
                  }
                >
                  <button
                    type="button"
                    onClick={() => sendMessage(prompt)}
                    className="pressable suggested-prompt-card group flex h-full min-h-[5.25rem] w-full items-center gap-3 rounded-2xl p-4 text-left transition-[background-color,border-color,box-shadow,transform] duration-[160ms] ease-out"
                  >
                    <span className="flex-1 text-sm leading-snug font-semibold">
                      {prompt}
                    </span>
                    <ArrowUpRight
                      className="h-4 w-4 shrink-0 text-[var(--color-blue)] opacity-80 transition-transform duration-[160ms] ease-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full space-y-6">
          {messages.map((message) => (
            <article
              key={message.stableKey}
              aria-live={
                message.role === "assistant" && isStreaming
                  ? "polite"
                  : undefined
              }
              className={
                message.role === "user"
                  ? "message-enter ml-auto w-fit max-w-[min(85%,36rem)]"
                  : "message-enter max-w-4xl"
              }
            >
              {message.role === "user" ? (
                <div className="rounded-[1.5rem] bg-[#E8F3FE] px-5 py-3 text-[#0B2749] dark:bg-[#163E75] dark:text-white">
                  <p className="whitespace-pre-wrap break-words text-[15px] font-medium leading-snug">
                    {message.content}
                  </p>
                </div>
              ) : (
                <>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-muted)] uppercase">
                    Helper
                  </p>
                  <MarkdownContent content={message.content || "…"} />

                  {message.content &&
                  !message.id.startsWith("local-") &&
                  feedbackByMessage[message.id] !== "hidden" ? (
                    feedbackByMessage[message.id] === "confirming" ||
                    feedbackByMessage[message.id] === "leaving" ? (
                      <div
                        className="feedback-confirm mt-4 flex items-center gap-2 text-sm font-medium text-[var(--color-primary-dark)]"
                        data-leaving={
                          feedbackByMessage[message.id] === "leaving"
                            ? ""
                            : undefined
                        }
                        role="status"
                        aria-live="polite"
                      >
                        <span className="feedback-confirm-icon inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-success-bg)]">
                          <Check className="h-4 w-4" aria-hidden="true" />
                        </span>
                        Thanks for your feedback
                      </div>
                    ) : (
                      <div className="mt-4 flex items-center gap-3">
                        <button
                          type="button"
                          aria-label="Helpful"
                          className="pressable rounded-md p-1 text-[var(--color-secondary)] transition-opacity hover-fine:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-dark)]"
                          onClick={() =>
                            submitFeedback(message.id, "HELPFUL")
                          }
                        >
                          <ThumbsUp className="h-5 w-5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label="Not helpful"
                          className="pressable rounded-md p-1 text-[var(--color-error)] transition-opacity hover-fine:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-dark)]"
                          onClick={() =>
                            submitFeedback(message.id, "NOT_HELPFUL")
                          }
                        >
                          <ThumbsDown className="h-5 w-5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label="Report incorrect"
                          className="pressable rounded-md p-1 text-[var(--color-gold)] transition-opacity hover-fine:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-dark)]"
                          onClick={() =>
                            submitFeedback(message.id, "INCORRECT")
                          }
                        >
                          <TriangleAlert
                            className="h-5 w-5"
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    )
                  ) : null}
                </>
              )}
            </article>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {status ? (
        <p
          className="mt-4 flex items-center gap-2 text-sm text-[var(--color-muted)]"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {status}
        </p>
      ) : null}
    </>
  );

  const contentWidthClass = "mx-auto w-full max-w-4xl";

  const composer = (
    <form
      className="pointer-events-auto w-full"
      onSubmit={(e) => {
        e.preventDefault();
        if (!hasInput || isStreaming) return;
        sendMessage(input);
      }}
    >
      <div
        className={cn(
          "composer-glass flex min-h-[52px] w-full items-end gap-1 rounded-[30px] border border-white/25 p-1.5",
          "shadow-[0_8px_28px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.35)]",
          "dark:border-white/12 dark:shadow-[0_8px_28px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.14)]",
        )}
      >
        <label htmlFor="chat-input" className="sr-only">
          Ask Helper
        </label>
        <Textarea
          id="chat-input"
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Helper"
          rows={1}
          disabled={isStreaming}
          className="max-h-40 min-h-10 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-3 py-2 text-base leading-6 text-[var(--color-foreground)] caret-[#007AFF] shadow-none outline-none ring-0 placeholder:text-[var(--color-muted)]/70 focus:border-0 focus:outline-none focus:ring-0 focus-visible:border-0 focus-visible:outline-none focus-visible:ring-0"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!hasInput || isStreaming) return;
              sendMessage(input);
            }
          }}
        />

        <Button
          type="submit"
          size="icon"
          aria-label={hasInput ? "Send message" : "Ask Helper"}
          disabled={!hasInput || isStreaming}
          className={cn(
            "size-10 shrink-0 self-end overflow-hidden rounded-full bg-[#06354B] p-0 text-[#A5D7F4] hover-fine:bg-[#052c3f] focus-visible:ring-[#06354B]",
            !hasInput && "disabled:opacity-100",
          )}
        >
          {isStreaming ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <ComposerActionIcon
              state={hasInput ? "send" : "idle"}
              className="size-full"
            />
          )}
        </Button>
      </div>
    </form>
  );

  const chatContent = (
    <>
    {rateLimitDialog}
    <div
      className={cn(
        "h-full min-h-0 flex-1",
        embedded ? "mx-auto flex w-full max-w-4xl flex-col" : "flex flex-col",
      )}
    >
      <section
        aria-label="Conversation"
        className="relative flex h-full min-h-0 flex-col"
      >
        {!embedded ? (
          <div
            className={cn(
              "flex shrink-0 justify-end px-4 pt-4 md:px-0 md:pt-6",
              contentWidthClass,
            )}
          >
            <Button variant="outline" onClick={startNewConversation}>
              New conversation
            </Button>
          </div>
        ) : null}

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-y-auto px-4 md:px-0",
            showEmptyState ? "pb-28 pt-4" : "pb-32 pt-4",
            !embedded && contentWidthClass,
          )}
        >
          {thread}
        </div>

        {/* Overlay dock so thread paints under the glass for backdrop-filter */}
        <div
          className={cn(
            "composer-dock pointer-events-none absolute inset-x-0 bottom-0 z-40 px-4 md:px-0",
            !embedded && contentWidthClass,
          )}
        >
          {composer}
        </div>
      </section>
    </div>
    </>
  );

  if (embedded) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[var(--color-background)]">
        {chatContent}
      </div>
    );
  }

  return (
    <AppShell contentClassName="flex h-full min-h-0 flex-col overflow-hidden !p-0 md:!px-8">
      {chatContent}
    </AppShell>
  );
}
