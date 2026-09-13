"use client";

import { useState } from "react";
import { RateLimitDialog } from "@/components/rate-limit-dialog";
import { isRateLimitPayload } from "@/lib/rate-limit";

export function useRateLimitDialog() {
  const [dialog, setDialog] = useState({
    open: false,
    title: "",
    message: "",
  });

  function handleRateLimitResponse(response: Response, data: unknown): boolean {
    if (response.status !== 429 || !isRateLimitPayload(data)) {
      return false;
    }

    setDialog({
      open: true,
      title: data.title,
      message: data.message,
    });
    return true;
  }

  const rateLimitDialog = (
    <RateLimitDialog
      open={dialog.open}
      onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
      title={dialog.title}
      message={dialog.message}
    />
  );

  return { handleRateLimitResponse, rateLimitDialog };
}
