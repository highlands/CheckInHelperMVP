"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRateLimitDialog } from "@/components/use-rate-limit-dialog";

export function SyncPanel() {
  const [loading, setLoading] = useState(false);
  const { handleRateLimitResponse, rateLimitDialog } = useRateLimitDialog();

  async function triggerSync(options?: {
    dryRun?: boolean;
    retryFailedOnly?: boolean;
  }) {
    setLoading(true);
    const response = await fetch("/api/admin/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options ?? {}),
    });
    const data = await response.json();
    if (!response.ok) {
      if (!handleRateLimitResponse(response, data)) {
        toast.error(data.error ?? "Sync failed.");
      }
    } else {
      toast.success(
        `Sync ${data.status}. Added ${data.summary.added}, updated ${data.summary.updated}, unchanged ${data.summary.unchanged}, failed ${data.summary.failed}.`,
      );
    }
    setLoading(false);
  }

  return (
    <>
      {rateLimitDialog}
      <Card>
      <CardHeader>
        <CardTitle>Manual synchronization</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button onClick={() => triggerSync()} disabled={loading}>
          Run full sync
        </Button>
        <Button
          variant="outline"
          onClick={() => triggerSync({ dryRun: true })}
          disabled={loading}
        >
          Dry run
        </Button>
        <Button
          variant="outline"
          onClick={() => triggerSync({ retryFailedOnly: true })}
          disabled={loading}
        >
          Retry failed
        </Button>
      </CardContent>
    </Card>
    </>
  );
}
