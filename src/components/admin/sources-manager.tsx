"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { KnowledgeSource } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRateLimitDialog } from "@/components/use-rate-limit-dialog";
import { formatDateTime } from "@/lib/utils";

export function SourcesManager({
  initialSources,
}: {
  initialSources: KnowledgeSource[];
}) {
  const [sources, setSources] = useState(initialSources);
  const [pageIdOrUrl, setPageIdOrUrl] = useState("");
  const [category, setCategory] = useState("general");
  const [loading, setLoading] = useState(false);
  const { handleRateLimitResponse, rateLimitDialog } = useRateLimitDialog();

  async function refreshSources() {
    const response = await fetch("/api/admin/sources");
    if (response.ok) {
      setSources(await response.json());
    }
  }

  async function addSource(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const response = await fetch("/api/admin/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageIdOrUrl,
        category,
        audience: "staff",
        classification: "internal",
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      toast.error(data.error ?? "Unable to add source.");
    } else {
      setPageIdOrUrl("");
      toast.success("Source added successfully.");
      await refreshSources();
    }
    setLoading(false);
  }

  async function toggleSource(id: string, enabled: boolean) {
    await fetch(`/api/admin/sources/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    await refreshSources();
  }

  async function syncSource(id: string) {
    toast.message("Sync started…");
    const response = await fetch("/api/admin/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: id }),
    });
    const data = await response.json();
    if (response.ok) {
      toast.success(`Sync finished with status ${data.status}.`);
    } else if (!handleRateLimitResponse(response, data)) {
      toast.error(data.error ?? "Sync failed.");
    }
    await refreshSources();
  }

  async function deleteSource(id: string) {
    if (!confirm("Delete this source?")) return;
    await fetch(`/api/admin/sources/${id}`, { method: "DELETE" });
    await refreshSources();
  }

  return (
    <>
      {rateLimitDialog}
      <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add Confluence source</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={addSource} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="pageIdOrUrl">Confluence URL or page ID</Label>
              <Input
                id="pageIdOrUrl"
                value={pageIdOrUrl}
                onChange={(e) => setPageIdOrUrl(e.target.value)}
                placeholder="https://your-domain.atlassian.net/wiki/spaces/IT/pages/123456/..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={loading}>
                Validate and add
              </Button>
            </div>
          </form>
          <p className="mt-4 text-sm text-[var(--color-muted)]">
            Sources must be publicly accessible Confluence pages. The app fetches
            content anonymously through the Confluence REST API and does not use
            Atlassian credentials.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {sources.length === 0 ? (
          <Card className="p-8 text-center text-[var(--color-muted)]">
            No approved sources yet.
          </Card>
        ) : (
          sources.map((source) => (
            <Card key={source.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>{source.title}</CardTitle>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    {source.sourceUrl}
                  </p>
                </div>
                <Badge variant={source.enabled ? "success" : "muted"}>
                  {source.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge>{source.status}</Badge>
                  <Badge variant="muted">
                    v{source.lastKnownVersion ?? "—"}
                  </Badge>
                  <Badge variant="muted">{source.spaceKey ?? "No space"}</Badge>
                </div>
                <p>
                  Last sync: {formatDateTime(source.lastSuccessfulSyncAt)} ·
                  Attempted: {formatDateTime(source.lastAttemptedSyncAt)}
                </p>
                {source.lastError ? (
                  <p className="text-[var(--color-error)]">
                    {source.lastError}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => syncSource(source.id)}
                  >
                    Sync source
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleSource(source.id, !source.enabled)}
                  >
                    {source.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteSource(source.id)}
                  >
                    Delete
                  </Button>
                  <a
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center rounded-xl px-3 text-sm font-semibold text-[var(--color-secondary)]"
                  >
                    Open Confluence
                  </a>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
    </>
  );
}
