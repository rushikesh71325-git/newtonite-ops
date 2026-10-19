import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Clock,
  Inbox,
  Eye,
  CheckCircle2,
  Plus,
  ArrowRight,
  ShieldAlert,
  Loader2,
  RefreshCw,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import useWorkspaceId from "@/hooks/use-workspace-id";
import {
  getAttentionQueryFn,
  claimItemMutationFn,
  transitionItemMutationFn,
} from "@/lib/api";
import { WorkItemType, AttentionResponseType } from "@/types/api.type";
import { CreateItemDialog } from "@/components/workspace/item/create-item-dialog";

export const NeedsAttention: React.FC = () => {
  const workspaceId = useWorkspaceId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Poll every 20 seconds, refetch on window focus per Section 10
  const { data, isLoading, isRefetching, refetch } = useQuery<AttentionResponseType>({
    queryKey: ["attention", workspaceId],
    queryFn: () => getAttentionQueryFn(workspaceId),
    enabled: !!workspaceId,
    refetchInterval: 20000,
    refetchOnWindowFocus: true,
  });

  // Quick claim mutation with optimistic update & 409 handling
  const claimMutation = useMutation({
    mutationFn: claimItemMutationFn,
    onMutate: async ({ itemId }) => {
      await queryClient.cancelQueries({ queryKey: ["attention", workspaceId] });
      const previous = queryClient.getQueryData<AttentionResponseType>([
        "attention",
        workspaceId,
      ]);

      if (previous) {
        queryClient.setQueryData<AttentionResponseType>(
          ["attention", workspaceId],
          {
            ...previous,
            unassignedUrgent: previous.unassignedUrgent.filter(
              (i) => i._id !== itemId
            ),
          }
        );
      }
      return { previous };
    },
    onError: (err: any, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["attention", workspaceId], context.previous);
      }
      toast({
        title: "Claim conflict",
        description:
          err.response?.data?.message ||
          err.message ||
          "Another user may have claimed this item.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["attention", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["items", workspaceId] });
    },
    onSuccess: (res) => {
      toast({
        title: "Item claimed",
        description: res.message || "You are now assigned to this item.",
      });
    },
  });

  // Quick approve mutation
  const approveMutation = useMutation({
    mutationFn: transitionItemMutationFn,
    onSuccess: () => {
      toast({ title: "Approved", description: "Work item approved and resolved." });
      queryClient.invalidateQueries({ queryKey: ["attention", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["items", workspaceId] });
    },
    onError: (err: any) => {
      toast({
        title: "Approval failed",
        description: err.response?.data?.message || err.message,
        variant: "destructive",
      });
    },
  });

  const waitingApproval = data?.waitingApproval || [];
  const mineOverdue = data?.mineOverdue || [];
  const unassignedUrgent = data?.unassignedUrgent || [];
  const stale = data?.stale || [];
  const changedSinceLastSeen = data?.changedSinceLastSeen || [];

  const totalActionable =
    waitingApproval.length +
    mineOverdue.length +
    unassignedUrgent.length +
    stale.length +
    changedSinceLastSeen.length;

  const getPriorityBadgeClass = (p: string) => {
    switch (p) {
      case "URGENT":
        return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-300 dark:border-red-800";
      case "HIGH":
        return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-800";
      case "MEDIUM":
        return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-800";
      default:
        return "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400 border-zinc-300 dark:border-zinc-800";
    }
  };

  const getStateBadgeClass = (s: string) => {
    switch (s) {
      case "OPEN":
        return "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-300";
      case "IN_PROGRESS":
        return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-300";
      case "PENDING_APPROVAL":
        return "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-300";
      case "RESOLVED":
        return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-300";
      case "CLOSED":
        return "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400 border-zinc-300";
      default:
        return "bg-zinc-500/15 text-zinc-700";
    }
  };

  const renderItemCard = (item: WorkItemType, category: string) => {
    const isClaiming =
      claimMutation.isPending &&
      claimMutation.variables?.itemId === item._id;
    const isApproving =
      approveMutation.isPending &&
      approveMutation.variables?.itemId === item._id;

    const teamName =
      typeof item.teamId === "object" ? item.teamId.name : "Team";
    const ownerName =
      typeof item.ownerId === "object" && item.ownerId
        ? item.ownerId.name
        : "Unassigned";

    return (
      <Card
        key={item._id}
        className="group hover:border-zinc-400 dark:hover:border-zinc-600 transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
        onClick={() => navigate(`/workspace/${workspaceId}/items/${item._id}`)}
      >
        <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex-1 space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono font-semibold text-zinc-500 dark:text-zinc-400">
                v{item.version}
              </span>
              <Badge variant="outline" className={getPriorityBadgeClass(item.priority)}>
                {item.priority}
              </Badge>
              <Badge variant="outline" className={getStateBadgeClass(item.state)}>
                {item.state.replace("_", " ")}
              </Badge>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {teamName}
              </span>
              {item.attentionReason && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                  {item.attentionReason}
                </span>
              )}
            </div>

            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              {item.title}
            </h3>

            <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400 flex-wrap">
              <span>Owner: <strong className="text-zinc-700 dark:text-zinc-300">{ownerName}</strong></span>
              {item.dueDate && (
                <span>
                  Due:{" "}
                  <strong className={new Date(item.dueDate) < new Date() ? "text-red-600 dark:text-red-400" : ""}>
                    {new Date(item.dueDate).toLocaleDateString()}
                  </strong>
                </span>
              )}
              <span>Updated: {new Date(item.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>

          <div
            className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-zinc-100 dark:border-zinc-800"
            onClick={(e) => e.stopPropagation()}
          >
            {category === "waitingApproval" && (
              <Button
                size="sm"
                className="bg-purple-600 hover:bg-purple-700 text-white text-xs h-8"
                disabled={isApproving}
                onClick={() =>
                  approveMutation.mutate({
                    workspaceId,
                    itemId: item._id,
                    action: "approve",
                    data: { expectedVersion: item.version },
                    idempotencyKey: crypto.randomUUID(),
                  })
                }
              >
                {isApproving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                Approve
              </Button>
            )}

            {category === "unassignedUrgent" && (
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8"
                disabled={isClaiming}
                onClick={() =>
                  claimMutation.mutate({
                    workspaceId,
                    itemId: item._id,
                    expectedVersion: item.version,
                    idempotencyKey: crypto.randomUUID(),
                  })
                }
              >
                {isClaiming ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <UserCheck className="h-3 w-3 mr-1" />}
                Claim Item
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              className="text-xs h-8"
              onClick={() => navigate(`/workspace/${workspaceId}/items/${item._id}`)}
            >
              Review <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Operations Center: Needs Attention
            </h1>
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            High-urgency operational queues requiring immediate action or oversight
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            className="text-xs bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-50 dark:text-zinc-900"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            New Work Item
          </Button>
        </div>
      </div>

      {/* Summary KPI metric strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="p-3.5 rounded-xl border border-purple-200 dark:border-purple-900/60 bg-purple-50/50 dark:bg-purple-950/20">
          <div className="flex items-center justify-between text-xs font-medium text-purple-800 dark:text-purple-300">
            <span>Awaiting Approval</span>
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div className="text-2xl font-bold text-purple-950 dark:text-purple-100 mt-1">
            {waitingApproval.length}
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/20">
          <div className="flex items-center justify-between text-xs font-medium text-red-800 dark:text-red-300">
            <span>Mine & Overdue</span>
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="text-2xl font-bold text-red-950 dark:text-red-100 mt-1">
            {mineOverdue.length}
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-orange-200 dark:border-orange-900/60 bg-orange-50/50 dark:bg-orange-950/20">
          <div className="flex items-center justify-between text-xs font-medium text-orange-800 dark:text-orange-300">
            <span>Unassigned High</span>
            <Inbox className="h-4 w-4" />
          </div>
          <div className="text-2xl font-bold text-orange-950 dark:text-orange-100 mt-1">
            {unassignedUrgent.length}
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40">
          <div className="flex items-center justify-between text-xs font-medium text-zinc-700 dark:text-zinc-300">
            <span>Inactive / Stale</span>
            <Clock className="h-4 w-4" />
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">
            {stale.length}
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 col-span-2 md:col-span-1">
          <div className="flex items-center justify-between text-xs font-medium text-blue-800 dark:text-blue-300">
            <span>Updated Since View</span>
            <Eye className="h-4 w-4" />
          </div>
          <div className="text-2xl font-bold text-blue-950 dark:text-blue-100 mt-1">
            {changedSinceLastSeen.length}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 flex flex-col items-center justify-center gap-2 text-zinc-500">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
          <p className="text-sm font-medium">Scanning operational queues...</p>
        </div>
      ) : totalActionable === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 py-16 text-center space-y-3 bg-zinc-50/50 dark:bg-zinc-900/20">
          <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
          <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">
            All Queues Clear
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
            No items are overdue, waiting on your approval, or unassigned urgent.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/workspace/${workspaceId}/items`)}
            className="text-xs"
          >
            Browse Operations Queue
          </Button>
        </div>
      ) : (
        <Tabs defaultValue="all" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <TabsList className="bg-zinc-100 dark:bg-zinc-800 p-1">
              <TabsTrigger value="all" className="text-xs">
                All Actionable ({totalActionable})
              </TabsTrigger>
              <TabsTrigger value="approvals" className="text-xs">
                Approvals ({waitingApproval.length})
              </TabsTrigger>
              <TabsTrigger value="overdue" className="text-xs">
                Overdue ({mineOverdue.length})
              </TabsTrigger>
              <TabsTrigger value="unassigned" className="text-xs">
                Unassigned ({unassignedUrgent.length})
              </TabsTrigger>
              <TabsTrigger value="stale" className="text-xs">
                Stale ({stale.length})
              </TabsTrigger>
              <TabsTrigger value="changed" className="text-xs">
                Changed ({changedSinceLastSeen.length})
              </TabsTrigger>
            </TabsList>

            <Link
              to={`/workspace/${workspaceId}/items`}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center"
            >
              See all items in queue <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </div>

          <TabsContent value="all" className="space-y-6">
            {waitingApproval.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-purple-700 dark:text-purple-400 flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4" /> Awaiting Your Approval ({waitingApproval.length})
                  </h2>
                </div>
                <div className="space-y-2">
                  {waitingApproval.map((item) => renderItemCard(item, "waitingApproval"))}
                </div>
              </section>
            )}

            {mineOverdue.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-red-600 dark:text-red-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" /> Mine & Overdue ({mineOverdue.length})
                  </h2>
                </div>
                <div className="space-y-2">
                  {mineOverdue.map((item) => renderItemCard(item, "mineOverdue"))}
                </div>
              </section>
            )}

            {unassignedUrgent.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400 flex items-center gap-1.5">
                    <Inbox className="h-4 w-4" /> Unassigned in My Teams ({unassignedUrgent.length})
                  </h2>
                </div>
                <div className="space-y-2">
                  {unassignedUrgent.map((item) => renderItemCard(item, "unassignedUrgent"))}
                </div>
              </section>
            )}

            {stale.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5">
                    <Clock className="h-4 w-4" /> Inactive Work Items ({stale.length})
                  </h2>
                </div>
                <div className="space-y-2">
                  {stale.map((item) => renderItemCard(item, "stale"))}
                </div>
              </section>
            )}

            {changedSinceLastSeen.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                    <Eye className="h-4 w-4" /> Changed Since Last Reviewed ({changedSinceLastSeen.length})
                  </h2>
                </div>
                <div className="space-y-2">
                  {changedSinceLastSeen.map((item) => renderItemCard(item, "changedSinceLastSeen"))}
                </div>
              </section>
            )}
          </TabsContent>

          <TabsContent value="approvals" className="space-y-2">
            {waitingApproval.length === 0 ? (
              <p className="text-xs text-zinc-500 py-6 text-center">No items awaiting your approval.</p>
            ) : (
              waitingApproval.map((item) => renderItemCard(item, "waitingApproval"))
            )}
          </TabsContent>

          <TabsContent value="overdue" className="space-y-2">
            {mineOverdue.length === 0 ? (
              <p className="text-xs text-zinc-500 py-6 text-center">No overdue items assigned to you.</p>
            ) : (
              mineOverdue.map((item) => renderItemCard(item, "mineOverdue"))
            )}
          </TabsContent>

          <TabsContent value="unassigned" className="space-y-2">
            {unassignedUrgent.length === 0 ? (
              <p className="text-xs text-zinc-500 py-6 text-center">No unassigned urgent items in your teams.</p>
            ) : (
              unassignedUrgent.map((item) => renderItemCard(item, "unassignedUrgent"))
            )}
          </TabsContent>

          <TabsContent value="stale" className="space-y-2">
            {stale.length === 0 ? (
              <p className="text-xs text-zinc-500 py-6 text-center">No stale items found.</p>
            ) : (
              stale.map((item) => renderItemCard(item, "stale"))
            )}
          </TabsContent>

          <TabsContent value="changed" className="space-y-2">
            {changedSinceLastSeen.length === 0 ? (
              <p className="text-xs text-zinc-500 py-6 text-center">No items have changed since your last review.</p>
            ) : (
              changedSinceLastSeen.map((item) => renderItemCard(item, "changedSinceLastSeen"))
            )}
          </TabsContent>
        </Tabs>
      )}

      <CreateItemDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </div>
  );
};

export default NeedsAttention;
