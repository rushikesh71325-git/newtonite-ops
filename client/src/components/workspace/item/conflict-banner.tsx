import React from "react";
import { AlertCircle, RefreshCw, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkItemType } from "@/types/api.type";

interface ConflictBannerProps {
  conflictType: "STALE_VERSION" | "ALREADY_CLAIMED";
  serverItem: WorkItemType;
  userDraft?: {
    title?: string;
    description?: string;
    priority?: string;
    dueDate?: string | null;
  };
  onAcceptServer: () => void;
  onApplyDraftToLatest?: (latestVersion: number) => void;
}

export const ConflictBanner: React.FC<ConflictBannerProps> = ({
  conflictType,
  serverItem,
  userDraft,
  onAcceptServer,
  onApplyDraftToLatest,
}) => {
  const isClaimConflict = conflictType === "ALREADY_CLAIMED";
  const ownerName =
    typeof serverItem.ownerId === "object" && serverItem.ownerId?.name
      ? serverItem.ownerId.name
      : "Another team member";

  // Compute differences between draft and server copy
  const diffs: { field: string; draftValue: string; serverValue: string }[] = [];

  if (userDraft) {
    if (userDraft.title !== undefined && userDraft.title !== serverItem.title) {
      diffs.push({
        field: "Title",
        draftValue: userDraft.title,
        serverValue: serverItem.title,
      });
    }
    if (
      userDraft.description !== undefined &&
      userDraft.description !== serverItem.description
    ) {
      diffs.push({
        field: "Description",
        draftValue: userDraft.description,
        serverValue: serverItem.description || "(empty)",
      });
    }
    if (
      userDraft.priority !== undefined &&
      userDraft.priority !== serverItem.priority
    ) {
      diffs.push({
        field: "Priority",
        draftValue: userDraft.priority,
        serverValue: serverItem.priority,
      });
    }
    if (userDraft.dueDate !== undefined) {
      const draftDateStr = userDraft.dueDate
        ? new Date(userDraft.dueDate).toLocaleDateString()
        : "(none)";
      const serverDateStr = serverItem.dueDate
        ? new Date(serverItem.dueDate).toLocaleDateString()
        : "(none)";
      if (draftDateStr !== serverDateStr) {
        diffs.push({
          field: "Due Date",
          draftValue: draftDateStr,
          serverValue: serverDateStr,
        });
      }
    }
  }

  return (
    <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-4 shadow-sm animate-in fade-in slide-in-from-top-2">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {isClaimConflict
                ? `Conflict: ${ownerName} just claimed this item`
                : `Concurrent Update Detected (Server Version: v${serverItem.version})`}
            </h4>
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-amber-200/80 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300">
              HTTP 409 Conflict
            </span>
          </div>

          <p className="text-xs text-amber-800 dark:text-amber-300">
            {isClaimConflict
              ? `${ownerName} took ownership of this item concurrently. Your view has been reconciled with the server.`
              : `This item was modified by another operation while you had it open. Your draft has been preserved below so no work is lost.`}
          </p>

          {diffs.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-zinc-900">
              <div className="px-3 py-1.5 bg-amber-100/60 dark:bg-amber-900/40 text-xs font-semibold text-amber-900 dark:text-amber-200 flex justify-between">
                <span>Field Comparison</span>
                <span>Unsaved Draft vs Server State</span>
              </div>
              <div className="divide-y divide-amber-100 dark:divide-amber-900/30 text-xs">
                {diffs.map((d) => (
                  <div
                    key={d.field}
                    className="grid grid-cols-3 gap-2 px-3 py-2 items-center"
                  >
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {d.field}
                    </span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-mono bg-emerald-50 dark:bg-emerald-950/50 p-1 rounded">
                      Draft: {d.draftValue}
                    </span>
                    <span className="text-zinc-600 dark:text-zinc-400 font-mono bg-zinc-100 dark:bg-zinc-800 p-1 rounded">
                      Server: {d.serverValue}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              size="sm"
              variant="outline"
              className="bg-white dark:bg-zinc-800 border-amber-300 dark:border-amber-700 text-xs text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/60"
              onClick={onAcceptServer}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Discard Draft & Accept Server (v{serverItem.version})
            </Button>

            {!isClaimConflict && onApplyDraftToLatest && diffs.length > 0 && (
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs"
                onClick={() => onApplyDraftToLatest(serverItem.version)}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Apply My Draft to v{serverItem.version}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
