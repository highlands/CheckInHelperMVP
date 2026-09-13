"use client";

import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function RateLimitDialog({
  open,
  onOpenChange,
  title,
  message,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="rate-limit-description">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]">
              <Clock className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 space-y-2">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription id="rate-limit-description">
                {message}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
