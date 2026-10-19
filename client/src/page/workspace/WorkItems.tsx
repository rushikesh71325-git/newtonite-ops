import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Plus,
  UserCheck,
  AlertCircle,
  Loader2,
  ChevronRight,
  RefreshCw,
  SlidersHorizontal,
  X,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import useWorkspaceId from "@/hooks/use-workspace-id";
import { useAuthContext } from "@/context/auth-provider";
import {
  getItemsInfiniteQueryFn,
  getTeamsQueryFn,
  claimItemMutationFn,
} from "@/lib/api";
import {
  WorkItemState,
  WorkItemPriority,
  ListItemsResponseType,
} from "@/types/api.type";
import { CreateItemDialog } from "@/components/workspace/item/create-item-dialog";

const STATE_OPTIONS: { label: string; value: WorkItemState }[] = [
  { label: "Open", value: "OPEN" },
  { label: "In Progress", value: "IN_PROGRESS" },
  { label: "Pending Approval", value: "PENDING_APPROVAL" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "Closed", value: "CLOSED" },
];

const PRIORITY_OPTIONS: { label: string; value: WorkItemPriority }[] = [
  { label: "Urgent", value: "URGENT" },
  { label: "High", value: "HIGH" },
  { label: "Medium", value: "MEDIUM" },
  { label: "Low", value: "LOW" },
];

export const WorkItems: React.FC = () => {
  const workspaceId = useWorkspaceId();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters state
  const [selectedStates, setSelectedStates] = useState<WorkItemState[]>(
    searchParams.getAll("state") as WorkItemState[]
  );
  const [selectedPriority, setSelectedPriority] = useState<string>(
    searchParams.get("priority") || "all"
  );
  const [selectedTeam, setSelectedTeam] = useState<string>(
    searchParams.get("teamId") || "all"
  );
  const [assignmentFilter, setAssignmentFilter] = useState<string>(
    searchParams.get("assignment") || "all"
  );
  const [searchInput, setSearchInput] = useState<string>(
    searchParams.get("q") || ""
  );
  const [debouncedSearch, setDebouncedSearch] = useState<string>(searchInput);

  // Pagination cursor stack: array of cursors [null (page 1), cursor1, cursor2...]
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([null]);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);

  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setCursor(null);
      setCursorHistory([null]);
      setCurrentPageIndex(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Sync filters with query parameters
  useEffect(() => {
    const params = new URLSearchParams();
    selectedStates.forEach((st) => params.append("state", st));
    if (selectedPriority !== "all") params.set("priority", selectedPriority);
    if (selectedTeam !== "all") params.set("teamId", selectedTeam);
    if (assignmentFilter !== "all") params.set("assignment", assignmentFilter);
    if (debouncedSearch) params.set("q", debouncedSearch);
    setSearchParams(params, { replace: true });
  }, [
    selectedStates,
    selectedPriority,
    selectedTeam,
    assignmentFilter,
    debouncedSearch,
    setSearchParams,
  ]);

  // Fetch teams for filter dropdown
  const { data: teamsData } = useQuery({
    queryKey: ["teams", workspaceId],
    queryFn: () => getTeamsQueryFn(workspaceId),
    enabled: !!workspaceId,
  });

  // Calculate ownerId or unassigned
  const ownerParam =
    assignmentFilter === "mine"
      ? user?._id
      : assignmentFilter === "unassigned"
      ? "null"
      : undefined;

  // Fetch items list
  const {
    data: itemsResponse,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery<ListItemsResponseType>({
    queryKey: [
      "items",
      workspaceId,
      selectedStates,
      selectedPriority,
      selectedTeam,
      ownerParam,
      debouncedSearch,
      cursor,
    ],
    queryFn: () =>
      getItemsInfiniteQueryFn({
        workspaceId,
        state: selectedStates.length > 0 ? selectedStates : undefined,
        priority:
          selectedPriority !== "all"
            ? (selectedPriority as WorkItemPriority)
            : undefined,
        teamId: selectedTeam !== "all" ? selectedTeam : undefined,
        ownerId: ownerParam,
        search: debouncedSearch.trim() || undefined,
        cursor: cursor || undefined,
        limit: 25,
      }),
    enabled: !!workspaceId,
    refetchOnWindowFocus: true,
  });

  const items = itemsResponse?.items || [];
  const nextCursor = itemsResponse?.nextCursor;
  const hasMore = itemsResponse?.hasMore;

  // Toggle state pill filter
  const toggleState = (st: WorkItemState) => {
    setCursor(null);
    setCursorHistory([null]);
    setCurrentPageIndex(0);
    setSelectedStates((prev) =>
      prev.includes(st) ? prev.filter((s) => s !== st) : [...prev, st]
    );
  };

  const handleNextPage = () => {
    if (nextCursor) {
      setCursor(nextCursor);
      setCursorHistory((prev) => [...prev, nextCursor]);
      setCurrentPageIndex((prev) => prev + 1);
    }
  };

  const handlePrevPage = () => {
    if (currentPageIndex > 0) {
      const prevCursor = cursorHistory[currentPageIndex - 1];
      setCursor(prevCursor);
      setCurrentPageIndex((prev) => prev - 1);
    }
  };

  const resetFilters = () => {
    setSelectedStates([]);
    setSelectedPriority("all");
    setSelectedTeam("all");
    setAssignmentFilter("all");
    setSearchInput("");
    setDebouncedSearch("");
    setCursor(null);
    setCursorHistory([null]);
    setCurrentPageIndex(0);
  };

  // Quick claim mutation
  const claimMutation = useMutation({
    mutationFn: claimItemMutationFn,
    onSuccess: (res) => {
      toast({
        title: "Claimed successfully",
        description: res.message || "You are now assigned to this item.",
      });
      queryClient.invalidateQueries({ queryKey: ["items", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["attention", workspaceId] });
    },
    onError: (err: any) => {
      toast({
        title: "Claim failed",
        description:
          err.response?.data?.message ||
          err.message ||
          "Another operator may have already claimed this item.",
        variant: "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["items", workspaceId] });
    },
  });

  const getPriorityBadge = (p: WorkItemPriority) => {
    switch (p) {
      case "URGENT":
        return <Badge className="bg-red-500 hover:bg-red-600 text-white font-semibold">URGENT</Badge>;
      case "HIGH":
        return <Badge className="bg-amber-500 hover:bg-amber-600 text-white font-medium">HIGH</Badge>;
      case "MEDIUM":
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-200">MEDIUM</Badge>;
      case "LOW":
        return <Badge variant="outline" className="text-gray-500">LOW</Badge>;
    }
  };

  const getStateBadge = (st: WorkItemState) => {
    switch (st) {
      case "OPEN":
        return <Badge variant="outline" className="border-amber-400 text-amber-700 bg-amber-50 font-medium">Open</Badge>;
      case "IN_PROGRESS":
        return <Badge className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium">In Progress</Badge>;
      case "PENDING_APPROVAL":
        return <Badge className="bg-purple-600 hover:bg-purple-700 text-white font-medium">Pending Approval</Badge>;
      case "RESOLVED":
        return <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium">Resolved</Badge>;
      case "CLOSED":
        return <Badge variant="secondary" className="text-gray-600 bg-gray-200">Closed</Badge>;
    }
  };

  const hasActiveFilters =
    selectedStates.length > 0 ||
    selectedPriority !== "all" ||
    selectedTeam !== "all" ||
    assignmentFilter !== "all" ||
    debouncedSearch.length > 0;

  return (
    <main className="flex flex-1 flex-col p-4 md:p-6 space-y-5 max-w-7xl mx-auto w-full">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="h-6 w-6 text-indigo-600" />
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              Work Items
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Operational queue with cursor pagination, text search, and guarded state transitions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="h-9 gap-1.5"
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button
            onClick={() => setIsCreateOpen(true)}
            className="h-9 gap-1.5 bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            New Work Item
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <Card className="shadow-xs border-gray-200 bg-card">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search title, description or request type..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9 h-9"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Filter Dropdowns */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Priority Filter */}
              <Select
                value={selectedPriority}
                onValueChange={(val) => {
                  setSelectedPriority(val);
                  setCursor(null);
                  setCursorHistory([null]);
                  setCurrentPageIndex(0);
                }}
              >
                <SelectTrigger className="w-[130px] h-9 text-xs">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priorities</SelectItem>
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Team Filter */}
              <Select
                value={selectedTeam}
                onValueChange={(val) => {
                  setSelectedTeam(val);
                  setCursor(null);
                  setCursorHistory([null]);
                  setCurrentPageIndex(0);
                }}
              >
                <SelectTrigger className="w-[140px] h-9 text-xs">
                  <SelectValue placeholder="Team" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Teams</SelectItem>
                  {teamsData?.teams?.map((team) => (
                    <SelectItem key={team._id} value={team._id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Assignment Filter */}
              <Select
                value={assignmentFilter}
                onValueChange={(val) => {
                  setAssignmentFilter(val);
                  setCursor(null);
                  setCursorHistory([null]);
                  setCurrentPageIndex(0);
                }}
              >
                <SelectTrigger className="w-[140px] h-9 text-xs">
                  <SelectValue placeholder="Assignment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Assignees</SelectItem>
                  <SelectItem value="mine">Assigned to Me</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                >
                  <X className="h-3.5 w-3.5" />
                  Reset
                </Button>
              )}
            </div>
          </div>

          {/* State Pills Multi-Select */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-gray-100">
            <span className="text-xs font-medium text-gray-500 mr-1.5 flex items-center gap-1">
              <SlidersHorizontal className="h-3 w-3" /> State:
            </span>
            {STATE_OPTIONS.map((st) => {
              const isSelected = selectedStates.includes(st.value);
              return (
                <button
                  key={st.value}
                  type="button"
                  onClick={() => toggleState(st.value)}
                  className={`text-xs px-2.5 py-1 rounded-full transition-all border font-medium ${
                    isSelected
                      ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                      : "bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200"
                  }`}
                >
                  {st.label}
                </button>
              );
            })}
            {selectedStates.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedStates([])}
                className="text-xs text-indigo-600 hover:underline ml-1"
              >
                Clear states
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Main Work Items Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-16 text-muted-foreground space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            <p className="text-sm">Loading work items...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-center space-y-3">
            <div className="p-3 bg-gray-100 rounded-full text-gray-400">
              <AlertCircle className="h-8 w-8" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-gray-900">No work items found</h3>
              <p className="text-sm text-gray-500 max-w-sm">
                {hasActiveFilters
                  ? "No work items match the selected filter criteria. Try resetting or adjusting filters."
                  : "No operational work items created in this workspace yet."}
              </p>
            </div>
            {hasActiveFilters ? (
              <Button variant="outline" size="sm" onClick={resetFilters}>
                Clear all filters
              </Button>
            ) : (
              <Button
                size="sm"
                className="bg-indigo-600 hover:bg-indigo-700"
                onClick={() => setIsCreateOpen(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Create First Item
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-gray-50/75">
                <TableRow>
                  <TableHead className="w-[110px]">Priority</TableHead>
                  <TableHead className="w-[120px]">State</TableHead>
                  <TableHead className="min-w-[260px]">Title</TableHead>
                  <TableHead className="w-[150px]">Team</TableHead>
                  <TableHead className="w-[160px]">Owner</TableHead>
                  <TableHead className="w-[80px] text-center">Version</TableHead>
                  <TableHead className="w-[130px]">Updated</TableHead>
                  <TableHead className="w-[110px] text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const canClaim = item.allowedActions?.includes("claim");
                  const isClaiming =
                    claimMutation.isPending &&
                    claimMutation.variables?.itemId === item._id;

                  const teamName =
                    typeof item.teamId === "object" && item.teamId
                      ? item.teamId.name
                      : "Unassigned";

                  const ownerName =
                    typeof item.ownerId === "object" && item.ownerId
                      ? item.ownerId.name
                      : null;

                  return (
                    <TableRow
                      key={item._id}
                      className="hover:bg-gray-50/80 transition-colors group cursor-pointer"
                      onClick={() =>
                        navigate(`/workspace/${workspaceId}/items/${item._id}`)
                      }
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {getPriorityBadge(item.priority)}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {getStateBadge(item.state)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900 group-hover:text-indigo-600 transition-colors line-clamp-1">
                            {item.title}
                          </span>
                          <div className="flex items-center gap-1 mt-1">
                            <span className="text-[10px] font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded uppercase">
                              {item.requestType}
                            </span>
                            {item.dueDate && (
                              <span className="text-[10px] text-gray-500">
                                Due: {new Date(item.dueDate).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {teamName}
                      </TableCell>
                      <TableCell className="text-sm">
                        {ownerName ? (
                          <span className="font-medium text-gray-800">
                            {ownerName}
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                            Unassigned
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs text-gray-500">
                        v{item.version}
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {new Date(item.updatedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell
                        className="text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canClaim ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs font-medium border-amber-300 text-amber-800 hover:bg-amber-50"
                            disabled={isClaiming}
                            onClick={() =>
                              claimMutation.mutate({
                                workspaceId,
                                itemId: item._id,
                                expectedVersion: item.version,
                              })
                            }
                          >
                            {isClaiming ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : (
                              <UserCheck className="h-3 w-3 mr-1" />
                            )}
                            Claim
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs text-gray-500 group-hover:text-indigo-600 gap-1"
                            onClick={() =>
                              navigate(
                                `/workspace/${workspaceId}/items/${item._id}`
                              )
                            }
                          >
                            View
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Cursor Pagination Bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-600">
          <div>
            Showing <span className="font-semibold">{items.length}</span> items
            {currentPageIndex > 0 && (
              <span> (Page {currentPageIndex + 1})</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrevPage}
              disabled={currentPageIndex === 0 || isLoading}
              className="h-8 px-3 text-xs"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNextPage}
              disabled={!hasMore || !nextCursor || isLoading}
              className="h-8 px-3 text-xs"
            >
              Next Page
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </div>
      </div>

      {/* New Work Item Dialog */}
      <CreateItemDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </main>
  );
};

export default WorkItems;
