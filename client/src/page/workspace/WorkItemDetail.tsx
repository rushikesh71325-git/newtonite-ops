import React, { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  UserX,
  Send,
  Loader2,
  RefreshCw,
  Check,
  History,
  Edit3,
  Save,
  CheckCircle,
  XCircle,
  RotateCcw,
  Ban,
  FileCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import useWorkspaceId from "@/hooks/use-workspace-id";
import {
  getItemByIdQueryFn,
  getItemEventsQueryFn,
  recordItemViewMutationFn,
  updateItemFieldsMutationFn,
  claimItemMutationFn,
  releaseItemMutationFn,
  transitionItemMutationFn,
  addCommentMutationFn,
  getTeamsQueryFn,
} from "@/lib/api";
import {
  WorkItemType,
  WorkItemState,
  WorkItemPriority,
} from "@/types/api.type";
import { ConflictBanner } from "@/components/workspace/item/conflict-banner";

export const WorkItemDetail: React.FC = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const workspaceId = useWorkspaceId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Record view on mount
  useEffect(() => {
    if (itemId && workspaceId) {
      recordItemViewMutationFn({ workspaceId, itemId }).catch(() => {});
    }
  }, [itemId, workspaceId]);

  // Fetch Work Item
  const {
    data: itemData,
    isLoading: isItemLoading,
    refetch: refetchItem,
    isRefetching,
  } = useQuery({
    queryKey: ["item", workspaceId, itemId],
    queryFn: () => getItemByIdQueryFn({ workspaceId, itemId: itemId! }),
    enabled: !!itemId && !!workspaceId,
  });

  const item = itemData?.item;

  // Fetch Timeline Events
  const {
    data: eventsData,
    isLoading: isEventsLoading,
    refetch: refetchEvents,
  } = useQuery({
    queryKey: ["item-events", workspaceId, itemId],
    queryFn: () =>
      getItemEventsQueryFn({ workspaceId, itemId: itemId!, limit: 50 }),
    enabled: !!itemId && !!workspaceId,
  });

  // Fetch Teams
  const { data: teamsData } = useQuery({
    queryKey: ["teams", workspaceId],
    queryFn: () => getTeamsQueryFn(workspaceId),
    enabled: !!workspaceId,
  });

  // Edit Draft Form State
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftPriority, setDraftPriority] = useState<WorkItemPriority>("MEDIUM");
  const [draftDueDate, setDraftDueDate] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);

  // 409 Conflict State
  const [conflictServerItem, setConflictServerItem] =
    useState<WorkItemType | null>(null);

  // Synchronize draft form with item when item arrives or updates
  useEffect(() => {
    if (item && !isEditing) {
      setDraftTitle(item.title);
      setDraftDescription(item.description || "");
      setDraftPriority(item.priority);
      setDraftDueDate(
        item.dueDate ? new Date(item.dueDate).toISOString().substring(0, 10) : ""
      );
      setConflictServerItem(null);
    }
  }, [item, isEditing]);

  // Comment state & Idempotency key
  const [newComment, setNewComment] = useState("");
  const [commentIdempotencyKey, setCommentIdempotencyKey] = useState(
    () => crypto.randomUUID()
  );

  // Action Modals State
  const [actionModal, setActionModal] = useState<{
    action: "request_approval" | "resolve" | "reject" | null;
    note: string;
    approverId?: string;
  }>({
    action: null,
    note: "",
    approverId: undefined,
  });

  // --- Mutations ---

  // 1. Update metadata mutation (Optimistic locking guarded)
  const updateMutation = useMutation({
    mutationFn: (overrideVersion?: number) => {
      return updateItemFieldsMutationFn({
        workspaceId,
        itemId: itemId!,
        data: {
          title: draftTitle,
          description: draftDescription || undefined,
          priority: draftPriority,
          dueDate: draftDueDate ? new Date(draftDueDate).toISOString() : null,
          expectedVersion: overrideVersion ?? item!.version,
        },
      });
    },
    onSuccess: (res) => {
      toast({ title: "Updated", description: "Work item updated successfully." });
      setIsEditing(false);
      setConflictServerItem(null);
      queryClient.setQueryData(["item", workspaceId, itemId], { item: res.item });
      queryClient.invalidateQueries({
        queryKey: ["item-events", workspaceId, itemId],
      });
      queryClient.invalidateQueries({ queryKey: ["items", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["attention", workspaceId] });
    },
    onError: (err: any) => {
      const serverCurrent = err.current || err.response?.data?.current;
      if (err.code === "STALE_VERSION" || err.response?.status === 409) {
        if (serverCurrent) {
          setConflictServerItem(serverCurrent);
        } else {
          refetchItem();
        }
        toast({
          title: "Version Conflict (409)",
          description:
            "This item was updated by another user. Review changes below.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Update failed",
          description:
            err.response?.data?.message || err.message || "Failed to update item.",
          variant: "destructive",
        });
      }
    },
  });

  // 2. Claim mutation
  const claimMutation = useMutation({
    mutationFn: () =>
      claimItemMutationFn({
        workspaceId,
        itemId: itemId!,
        expectedVersion: item!.version,
      }),
    onSuccess: (res) => {
      toast({
        title: "Claimed successfully",
        description: res.message || "You are now assigned to this item.",
      });
      queryClient.setQueryData(["item", workspaceId, itemId], { item: res.item });
      queryClient.invalidateQueries({
        queryKey: ["item-events", workspaceId, itemId],
      });
      queryClient.invalidateQueries({ queryKey: ["items", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["attention", workspaceId] });
    },
    onError: (err: any) => {
      toast({
        title: "Claim conflict",
        description:
          err.response?.data?.message ||
          err.message ||
          "Another operator may have claimed this item.",
        variant: "destructive",
      });
      refetchItem();
    },
  });

  // 3. Release mutation
  const releaseMutation = useMutation({
    mutationFn: () =>
      releaseItemMutationFn({
        workspaceId,
        itemId: itemId!,
        expectedVersion: item!.version,
      }),
    onSuccess: (res) => {
      toast({
        title: "Released",
        description: "Work item has been released back to unassigned queue.",
      });
      queryClient.setQueryData(["item", workspaceId, itemId], { item: res.item });
      queryClient.invalidateQueries({
        queryKey: ["item-events", workspaceId, itemId],
      });
      queryClient.invalidateQueries({ queryKey: ["items", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["attention", workspaceId] });
    },
    onError: (err: any) => {
      toast({
        title: "Action failed",
        description: err.response?.data?.message || err.message,
        variant: "destructive",
      });
      refetchItem();
    },
  });

  // 4. State transition mutation
  const transitionMutation = useMutation({
    mutationFn: ({
      action,
      note,
      approverId,
    }: {
      action: string;
      note?: string;
      approverId?: string;
    }) =>
      transitionItemMutationFn({
        workspaceId,
        itemId: itemId!,
        action,
        data: {
          expectedVersion: item!.version,
          resolutionNote: action === "resolve" ? note : undefined,
          reason: action === "reject" ? note : undefined,
          comment: note,
          approverId,
        },
      }),
    onSuccess: (res, vars) => {
      toast({
        title: "Action executed",
        description: `Successfully performed action: ${vars.action}`,
      });
      setActionModal({ action: null, note: "", approverId: undefined });
      queryClient.setQueryData(["item", workspaceId, itemId], { item: res.item });
      queryClient.invalidateQueries({
        queryKey: ["item-events", workspaceId, itemId],
      });
      queryClient.invalidateQueries({ queryKey: ["items", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["attention", workspaceId] });
    },
    onError: (err: any) => {
      toast({
        title: "Transition failed",
        description:
          err.response?.data?.message ||
          err.message ||
          "Could not perform action due to state or permission rules.",
        variant: "destructive",
      });
      refetchItem();
    },
  });

  // 5. Add comment mutation with double-click Idempotency-Key
  const commentMutation = useMutation({
    mutationFn: () =>
      addCommentMutationFn({
        workspaceId,
        itemId: itemId!,
        text: newComment.trim(),
        idempotencyKey: commentIdempotencyKey,
      }),
    onSuccess: () => {
      toast({ title: "Comment posted" });
      setNewComment("");
      setCommentIdempotencyKey(crypto.randomUUID());
      queryClient.invalidateQueries({
        queryKey: ["item-events", workspaceId, itemId],
      });
    },
    onError: (err: any) => {
      setCommentIdempotencyKey(crypto.randomUUID());
      toast({
        title: "Comment failed",
        description: err.response?.data?.message || err.message,
        variant: "destructive",
      });
    },
  });

  // Handle overwrite from ConflictBanner
  const handleOverwriteConflict = (latestVersion: number) => {
    updateMutation.mutate(latestVersion);
  };

  // Handle discard draft from ConflictBanner
  const handleDiscardConflict = (freshServerItem: WorkItemType) => {
    setDraftTitle(freshServerItem.title);
    setDraftDescription(freshServerItem.description || "");
    setDraftPriority(freshServerItem.priority);
    setDraftDueDate(
      freshServerItem.dueDate
        ? new Date(freshServerItem.dueDate).toISOString().substring(0, 10)
        : ""
    );
    setConflictServerItem(null);
    setIsEditing(false);
    queryClient.setQueryData(["item", workspaceId, itemId], {
      item: freshServerItem,
    });
  };

  if (isItemLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-24 text-muted-foreground space-y-3">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="text-sm">Loading work item details...</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center p-24 text-center space-y-4">
        <AlertTriangle className="h-10 w-10 text-amber-500" />
        <h2 className="text-xl font-bold">Work Item Not Found</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          This item does not exist or you do not have permission to access it in this workspace.
        </p>
        <Button onClick={() => navigate(`/workspace/${workspaceId}/items`)}>
          Back to Work Items
        </Button>
      </div>
    );
  }

  const allowedActions = item.allowedActions || [];
  const events = eventsData?.events || [];

  const teamName =
    typeof item.teamId === "object" && item.teamId
      ? item.teamId.name
      : "Unassigned";

  const ownerName =
    typeof item.ownerId === "object" && item.ownerId
      ? item.ownerId.name
      : null;

  const approverName =
    typeof item.approverId === "object" && item.approverId
      ? item.approverId.name
      : null;

  const getPriorityBadge = (p: WorkItemPriority) => {
    switch (p) {
      case "URGENT":
        return <Badge className="bg-red-500 text-white font-semibold">URGENT</Badge>;
      case "HIGH":
        return <Badge className="bg-amber-500 text-white font-medium">HIGH</Badge>;
      case "MEDIUM":
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800">MEDIUM</Badge>;
      case "LOW":
        return <Badge variant="outline" className="text-gray-500">LOW</Badge>;
    }
  };

  const getStateBadge = (st: WorkItemState) => {
    switch (st) {
      case "OPEN":
        return <Badge variant="outline" className="border-amber-400 text-amber-700 bg-amber-50">Open</Badge>;
      case "IN_PROGRESS":
        return <Badge className="bg-indigo-600 text-white font-medium">In Progress</Badge>;
      case "PENDING_APPROVAL":
        return <Badge className="bg-purple-600 text-white font-medium">Pending Approval</Badge>;
      case "RESOLVED":
        return <Badge className="bg-emerald-600 text-white font-medium">Resolved</Badge>;
      case "CLOSED":
        return <Badge variant="secondary" className="text-gray-600 bg-gray-200">Closed</Badge>;
    }
  };

  return (
    <main className="flex flex-1 flex-col p-4 md:p-6 space-y-5 max-w-7xl mx-auto w-full">
      {/* Back & Breadcrumb */}
      <div className="flex items-center justify-between">
        <Link
          to={`/workspace/${workspaceId}/items`}
          className="inline-flex items-center text-sm text-gray-500 hover:text-indigo-600 transition-colors gap-1.5 font-medium"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Work Items Queue
        </Link>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>Version:</span>
          <Badge variant="outline" className="font-mono bg-gray-50">
            v{item.version}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              refetchItem();
              refetchEvents();
            }}
            disabled={isRefetching}
            className="h-7 w-7 p-0"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>

      {/* 409 Conflict Banner if Stale Version */}
      {conflictServerItem && (
        <ConflictBanner
          conflictType="STALE_VERSION"
          serverItem={conflictServerItem}
          userDraft={{
            title: draftTitle,
            description: draftDescription,
            priority: draftPriority,
            dueDate: draftDueDate || null,
          }}
          onAcceptServer={() => handleDiscardConflict(conflictServerItem)}
          onApplyDraftToLatest={(latestVer) =>
            handleOverwriteConflict(latestVer)
          }
        />
      )}

      {/* Main Header Card */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-2 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {getStateBadge(item.state)}
              {getPriorityBadge(item.priority)}
              <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded uppercase">
                {item.requestType}
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                ID: {item._id}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              {item.title}
            </h1>
          </div>

          {/* Action Buttons Panel (Driven STRICTLY by server allowedActions) */}
          <div className="flex flex-wrap items-center gap-2">
            {allowedActions.includes("claim") && (
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
                disabled={claimMutation.isPending}
                onClick={() => claimMutation.mutate()}
              >
                {claimMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserCheck className="h-4 w-4" />
                )}
                Claim Item
              </Button>
            )}

            {allowedActions.includes("release") && (
              <Button
                size="sm"
                variant="outline"
                className="text-gray-700 border-gray-300 gap-1.5"
                disabled={releaseMutation.isPending}
                onClick={() => releaseMutation.mutate()}
              >
                {releaseMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserX className="h-4 w-4" />
                )}
                Release Claim
              </Button>
            )}

            {allowedActions.includes("request_approval") && (
              <Button
                size="sm"
                className="bg-purple-600 hover:bg-purple-700 text-white gap-1.5"
                onClick={() =>
                  setActionModal({
                    action: "request_approval",
                    note: "",
                    approverId: undefined,
                  })
                }
              >
                <FileCheck className="h-4 w-4" />
                Request Approval
              </Button>
            )}

            {allowedActions.includes("approve") && (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                disabled={transitionMutation.isPending}
                onClick={() =>
                  transitionMutation.mutate({ action: "approve" })
                }
              >
                {transitionMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                Approve
              </Button>
            )}

            {allowedActions.includes("reject") && (
              <Button
                size="sm"
                variant="destructive"
                className="gap-1.5"
                onClick={() =>
                  setActionModal({
                    action: "reject",
                    note: "",
                    approverId: undefined,
                  })
                }
              >
                <XCircle className="h-4 w-4" />
                Reject
              </Button>
            )}

            {allowedActions.includes("resolve") && (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                onClick={() =>
                  setActionModal({
                    action: "resolve",
                    note: "",
                    approverId: undefined,
                  })
                }
              >
                <Check className="h-4 w-4" />
                Resolve
              </Button>
            )}

            {allowedActions.includes("close") && (
              <Button
                size="sm"
                variant="secondary"
                className="text-gray-700 gap-1.5"
                disabled={transitionMutation.isPending}
                onClick={() =>
                  transitionMutation.mutate({ action: "close" })
                }
              >
                <CheckCircle2 className="h-4 w-4" />
                Close
              </Button>
            )}

            {allowedActions.includes("reopen") && (
              <Button
                size="sm"
                variant="outline"
                className="text-indigo-700 border-indigo-200 hover:bg-indigo-50 gap-1.5"
                disabled={transitionMutation.isPending}
                onClick={() =>
                  transitionMutation.mutate({ action: "reopen" })
                }
              >
                <RotateCcw className="h-4 w-4" />
                Reopen
              </Button>
            )}

            {allowedActions.includes("cancel") && (
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600 hover:bg-red-50 gap-1.5"
                disabled={transitionMutation.isPending}
                onClick={() =>
                  transitionMutation.mutate({ action: "cancel" })
                }
              >
                <Ban className="h-4 w-4" />
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Two Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 spans): Edit Form + Activity Timeline */}
        <div className="lg:col-span-2 space-y-6">
          {/* Metadata & Details Card */}
          <Card className="shadow-xs border-gray-200">
            <CardHeader className="py-4 px-5 border-b border-gray-100 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold text-gray-900">
                Work Item Details
              </CardTitle>
              {!isEditing ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsEditing(true)}
                  className="h-8 gap-1 text-xs"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Edit Fields
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsEditing(false);
                      setDraftTitle(item.title);
                      setDraftDescription(item.description || "");
                      setDraftPriority(item.priority);
                      setDraftDueDate(
                        item.dueDate
                          ? new Date(item.dueDate).toISOString().substring(0, 10)
                          : ""
                      );
                    }}
                    className="h-8 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => updateMutation.mutate(item.version)}
                    disabled={updateMutation.isPending || !draftTitle.trim()}
                    className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 gap-1"
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Save (v{item.version})
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              {isEditing ? (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-700 mb-1 block">
                      Title *
                    </label>
                    <Input
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      placeholder="Title of the work item"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-700 mb-1 block">
                      Description
                    </label>
                    <Textarea
                      rows={4}
                      value={draftDescription}
                      onChange={(e) => setDraftDescription(e.target.value)}
                      placeholder="Operational details and instructions..."
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-gray-700 mb-1 block">
                        Priority
                      </label>
                      <Select
                        value={draftPriority}
                        onValueChange={(val) =>
                          setDraftPriority(val as WorkItemPriority)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="LOW">Low</SelectItem>
                          <SelectItem value="MEDIUM">Medium</SelectItem>
                          <SelectItem value="HIGH">High</SelectItem>
                          <SelectItem value="URGENT">Urgent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-700 mb-1 block">
                        Due Date
                      </label>
                      <Input
                        type="date"
                        value={draftDueDate}
                        onChange={(e) => setDraftDueDate(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">
                      Description
                    </span>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50/60 p-3.5 rounded-md border border-gray-100 min-h-[60px]">
                      {item.description || "No description provided."}
                    </p>
                  </div>

                  {item.dueDate && (
                    <div>
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">
                        Due Date
                      </span>
                      <p className="text-sm text-gray-800">
                        {new Date(item.dueDate).toLocaleDateString(undefined, {
                          weekday: "short",
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                  )}

                  {item.resolutionNote && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3.5">
                      <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wider block mb-1">
                        Resolution Note
                      </span>
                      <p className="text-sm text-emerald-900 whitespace-pre-wrap">
                        {item.resolutionNote}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity Timeline Card */}
          <Card className="shadow-xs border-gray-200">
            <CardHeader className="py-4 px-5 border-b border-gray-100 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-indigo-600" />
                <CardTitle className="text-base font-semibold text-gray-900">
                  Activity & Audit Timeline
                </CardTitle>
              </div>
              <span className="text-xs text-muted-foreground">
                {events.length} event{events.length === 1 ? "" : "s"}
              </span>
            </CardHeader>
            <CardContent className="p-5 space-y-5">
              {/* Add Comment Input */}
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/60 space-y-2">
                <Textarea
                  rows={2}
                  value={newComment}
                  onChange={(e) => {
                    setNewComment(e.target.value);
                    setCommentIdempotencyKey(crypto.randomUUID());
                  }}
                  placeholder="Add a comment to this work item..."
                  className="bg-white text-sm"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={!newComment.trim() || commentMutation.isPending}
                    onClick={() => commentMutation.mutate()}
                    className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 gap-1.5"
                  >
                    {commentMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Post Comment
                  </Button>
                </div>
              </div>

              {/* Events Stream */}
              {isEventsLoading ? (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Loading activity timeline...
                </div>
              ) : events.length === 0 ? (
                <div className="text-center py-6 text-sm text-gray-500">
                  No activity logged yet.
                </div>
              ) : (
                <div className="relative pl-6 space-y-5 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[2px] before:bg-gray-200">
                  {events.map((evt) => {
                    const actorName =
                      typeof evt.actorId === "object" && evt.actorId
                        ? evt.actorId.name
                        : "User";

                    return (
                      <div key={evt._id} className="relative group">
                        {/* Timeline dot */}
                        <div className="absolute -left-6 top-1.5 h-3.5 w-3.5 rounded-full bg-white border-2 border-indigo-600 shadow-xs" />
                        <div className="bg-white p-3 rounded-md border border-gray-100 shadow-2xs space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-gray-900">
                              {actorName}
                            </span>
                            <span className="text-gray-400">
                              {new Date(evt.createdAt).toLocaleString(
                                undefined,
                                {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }
                              )}
                            </span>
                          </div>
                          <div className="text-xs text-gray-700">
                            {evt.type === "created" && (
                              <span>Created work item in Open state</span>
                            )}
                            {evt.type === "claimed" && (
                              <span>Claimed work item (assigned to self)</span>
                            )}
                            {evt.type === "released" && (
                              <span>Released item claim</span>
                            )}
                            {evt.type === "state_changed" && (
                              <span>
                                Changed state from{" "}
                                <strong className="font-mono text-gray-800">
                                  {evt.from}
                                </strong>{" "}
                                to{" "}
                                <strong className="font-mono text-indigo-700">
                                  {evt.to}
                                </strong>
                              </span>
                            )}
                            {evt.type === "comment_added" && (
                              <p className="mt-1 text-sm text-gray-800 bg-gray-50 p-2.5 rounded border border-gray-200">
                                {evt.payload?.comment || evt.payload?.text}
                              </p>
                            )}
                            {evt.payload?.resolutionNote && (
                              <p className="mt-1 text-xs italic text-emerald-700 bg-emerald-50/50 p-2 rounded border border-emerald-100">
                                Resolution: &ldquo;{evt.payload.resolutionNote}&rdquo;
                              </p>
                            )}
                            {evt.payload?.reason && (
                              <p className="mt-1 text-xs italic text-red-700 bg-red-50/50 p-2 rounded border border-red-100">
                                Reason: &ldquo;{evt.payload.reason}&rdquo;
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column (1 span): Metadata Snapshot */}
        <div className="space-y-6">
          <Card className="shadow-xs border-gray-200">
            <CardHeader className="py-4 px-5 border-b border-gray-100">
              <CardTitle className="text-base font-semibold text-gray-900">
                Operational Metadata
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-4 text-xs">
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500 font-medium">Current State</span>
                <span className="font-semibold">{getStateBadge(item.state)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500 font-medium">Priority</span>
                <span className="font-semibold">{getPriorityBadge(item.priority)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500 font-medium">Request Type</span>
                <span className="font-semibold uppercase text-gray-800">
                  {item.requestType}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500 font-medium">Assigned Team</span>
                <span className="font-semibold text-gray-800">
                  {teamName}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500 font-medium">Owner</span>
                <span className="font-semibold text-gray-800">
                  {ownerName || "Unassigned"}
                </span>
              </div>
              {approverName && (
                <div className="flex justify-between py-1 border-b border-gray-100">
                  <span className="text-gray-500 font-medium">Designated Approver</span>
                  <span className="font-semibold text-purple-700">
                    {approverName}
                  </span>
                </div>
              )}
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500 font-medium">Lock Version</span>
                <span className="font-mono font-semibold text-indigo-700">
                  v{item.version}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500 font-medium">Created At</span>
                <span className="text-gray-700">
                  {new Date(item.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500 font-medium">Last Updated</span>
                <span className="text-gray-700">
                  {new Date(item.updatedAt).toLocaleString()}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Action Dialog (for Request Approval, Resolve, and Reject notes) */}
      <Dialog
        open={actionModal.action !== null}
        onOpenChange={(open) => {
          if (!open) {
            setActionModal({ action: null, note: "", approverId: undefined });
          }
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {actionModal.action === "request_approval" && "Request Approval"}
              {actionModal.action === "resolve" && "Resolve Work Item"}
              {actionModal.action === "reject" && "Reject Approval Request"}
            </DialogTitle>
            <DialogDescription>
              {actionModal.action === "request_approval" &&
                "Select a team lead or admin to review and approve this work item."}
              {actionModal.action === "resolve" &&
                "Provide an operational resolution note describing what was completed."}
              {actionModal.action === "reject" &&
                "Provide a mandatory rejection reason explaining why approval was denied."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {actionModal.action === "request_approval" && (
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">
                  Approver *
                </label>
                <Select
                  value={actionModal.approverId}
                  onValueChange={(val) =>
                    setActionModal((prev) => ({ ...prev, approverId: val }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select approver (Lead/Admin)" />
                  </SelectTrigger>
                  <SelectContent>
                    {teamsData?.teams?.map((team) => {
                      const leadId =
                        typeof team.leadId === "object" && team.leadId
                          ? team.leadId._id
                          : typeof team.leadId === "string"
                          ? team.leadId
                          : null;
                      if (!leadId) return null;
                      return (
                        <SelectItem key={team._id} value={leadId}>
                          Lead of {team.name}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                {actionModal.action === "reject" ? "Reason *" : "Note"}
              </label>
              <Textarea
                rows={3}
                value={actionModal.note}
                onChange={(e) =>
                  setActionModal((prev) => ({ ...prev, note: e.target.value }))
                }
                placeholder={
                  actionModal.action === "reject"
                    ? "Enter rejection reason..."
                    : "Add any context or resolution details..."
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setActionModal({ action: null, note: "", approverId: undefined })
              }
            >
              Cancel
            </Button>
            <Button
              disabled={
                transitionMutation.isPending ||
                (actionModal.action === "reject" && !actionModal.note.trim()) ||
                (actionModal.action === "request_approval" &&
                  !actionModal.approverId)
              }
              onClick={() => {
                if (actionModal.action) {
                  transitionMutation.mutate({
                    action: actionModal.action,
                    note: actionModal.note.trim() || undefined,
                    approverId: actionModal.approverId,
                  });
                }
              }}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {transitionMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Confirm Action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default WorkItemDetail;
