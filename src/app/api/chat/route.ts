import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { createId, dbError, getDb } from "@/lib/db";
import { getEnv, isLocalMockMode } from "@/lib/env";
import { createTraceId, logError } from "@/lib/logger";
import {
  checkRateLimit,
  CHAT_MAX_INPUT_LENGTH,
  sanitizeUserInput,
} from "@/lib/security";
import { createRateLimitResponse } from "@/lib/rate-limit";
import { createRetrievalProvider } from "@/lib/assistant/mock-provider";
import type { MappedCitation } from "@/lib/assistant/provider";

const chatSchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1).max(CHAT_MAX_INPUT_LENGTH),
});

function encodeSse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  const traceId = createTraceId();

  try {
    const session = await requireAuth();
    const env = getEnv();

    const rate = checkRateLimit(`chat:${session.user.id}`, env.CHAT_RATE_LIMIT);
    if (!rate.allowed) {
      return createRateLimitResponse("chat", rate.retryAfterMs);
    }

    const body = chatSchema.parse(await request.json());
    const messageContent = sanitizeUserInput(
      body.message,
      CHAT_MAX_INPUT_LENGTH,
    );

    let conversationId = body.conversationId;
    if (conversationId) {
      const { data: existing, error } = await getDb().from("Conversation").select("id").eq("id", conversationId).eq("userId", session.user.id).maybeSingle();
      if (error) dbError(error, "Unable to load conversation");
      if (!existing) {
        return new Response(
          JSON.stringify({ error: "Conversation not found." }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    } else {
      const now = new Date().toISOString();
      const { data: created, error } = await getDb().from("Conversation").insert({
        id: createId(),
        userId: session.user.id,
        title: messageContent.slice(0, 80),
        updatedAt: now,
      }).select("id").single();
      if (error || !created) dbError(error, "Unable to create conversation");
      conversationId = created.id;
    }
    const activeConversationId = conversationId;
    if (!activeConversationId) {
      throw new Error("Unable to initialize conversation.");
    }

    const { error: messageError } = await getDb().from("Message").insert({
      id: createId(),
      conversationId: activeConversationId,
      role: "user",
      content: messageContent,
    });
    if (messageError) dbError(messageError, "Unable to save message");

    const { data: history, error: historyError } = await getDb().from("Message").select("role, content").eq("conversationId", activeConversationId).order("createdAt", { ascending: true }).limit(20);
    if (historyError) dbError(historyError, "Unable to load conversation history");

    const provider = await createRetrievalProvider(isLocalMockMode());

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let assistantText = "";
        let completion:
          | {
            openaiResponseId?: string;
            model: string;
            latencyMs: number;
            retrievalCount: number;
            citations: MappedCitation[];
            diagnostics?: import("@/lib/assistant/citations").RetrievalDiagnostics;
          }
          | undefined;

        controller.enqueue(
          encoder.encode(
            encodeSse({
              type: "conversation",
              conversationId,
              traceId,
            }),
          ),
        );

        try {
          for await (const event of provider.streamChat({
            messages: (history ?? []).map((m: { role: string; content: string }) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
            traceId,
            conversationId: activeConversationId,
          })) {
            if (event.type === "status") {
              controller.enqueue(encoder.encode(encodeSse(event)));
            } else if (event.type === "delta") {
              assistantText += event.text;
              controller.enqueue(encoder.encode(encodeSse(event)));
            } else if (event.type === "completed") {
              assistantText = event.text;
              completion = {
                openaiResponseId: event.openaiResponseId,
                model: event.model,
                latencyMs: event.latencyMs,
                retrievalCount: event.retrievalCount,
                citations: event.citations,
                diagnostics: event.diagnostics,
              };
              controller.enqueue(encoder.encode(encodeSse(event)));
            } else if (event.type === "error") {
              controller.enqueue(encoder.encode(encodeSse(event)));
            }
          }

          if (completion) {
            const { data: assistantMessage, error: assistantError } = await getDb().from("Message").insert({
              id: createId(),
              conversationId,
              role: "assistant",
              content: assistantText,
              openaiResponseId: completion.openaiResponseId,
              model: completion.model,
              latencyMs: completion.latencyMs,
              retrievalCount: completion.retrievalCount,
              retrievalDiagnostics: completion.diagnostics ?? null,
            }).select("id").single();
            if (assistantError || !assistantMessage) dbError(assistantError, "Unable to save assistant message");

            if (completion.citations.length > 0) {
              const { error } = await getDb().from("MessageCitation").insert(completion.citations.map((c) => ({
                id: createId(),
                messageId: assistantMessage.id,
                knowledgeSourceId: c.knowledgeSourceId,
                openaiFileId: c.openaiFileId,
                title: c.title,
                sourceUrl: c.sourceUrl,
                confluencePageId: c.confluencePageId,
                confluenceVersion: c.confluenceVersion,
                spaceKey: c.spaceKey,
                confluenceUpdatedAt: c.confluenceUpdatedAt
                  ? new Date(c.confluenceUpdatedAt).toISOString()
                  : null,
                snippet: c.snippet,
              })));
              if (error) dbError(error, "Unable to save citations");
            }

            const { error: updateError } = await getDb().from("Conversation").update({ updatedAt: new Date().toISOString() }).eq("id", conversationId);
            if (updateError) dbError(updateError, "Unable to update conversation");

            controller.enqueue(
              encoder.encode(
                encodeSse({
                  type: "saved",
                  messageId: assistantMessage.id,
                  citations: completion.citations,
                }),
              ),
            );
          }
        } catch (error) {
          logError("chat.stream.failed", error, {
            traceId,
            conversationId,
            userId: session.user.id,
          });
          controller.enqueue(
            encoder.encode(
              encodeSse({
                type: "error",
                message: "Something went wrong while generating a response.",
              }),
            ),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response(JSON.stringify({ error: "Invalid chat request." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    logError("chat.request.failed", error, { traceId });
    return new Response(
      JSON.stringify({
        error: "Unable to process chat request.",
        traceId,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
