import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import useWorkspaceId from "@/hooks/use-workspace-id";
import { createItemMutationFn, getTeamsQueryFn } from "@/lib/api";

interface CreateItemDialogProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTeamId?: string;
}

export const CreateItemDialog: React.FC<CreateItemDialogProps> = ({
  isOpen,
  onClose,
  defaultTeamId,
}) => {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requestType, setRequestType] = useState("incident");
  const [priority, setPriority] = useState("MEDIUM");
  const [teamId, setTeamId] = useState(defaultTeamId || "");
  const [dueDate, setDueDate] = useState("");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
    crypto.randomUUID()
  );

  // Fetch teams for selector
  const { data: teamsData } = useQuery({
    queryKey: ["teams", workspaceId],
    queryFn: () => getTeamsQueryFn(workspaceId),
    enabled: isOpen && !!workspaceId,
  });

  const teams = teamsData?.teams || [];

  const { mutate, isPending } = useMutation({
    mutationFn: createItemMutationFn,
    onSuccess: (data) => {
      toast({
        title: "Item created",
        description: data.message || "Work item created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["attention"] });
      handleClose();
    },
    onError: (error: any) => {
      toast({
        title: "Creation failed",
        description: error.response?.data?.message || error.message || "Failed to create item",
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    setTitle("");
    setDescription("");
    setRequestType("incident");
    setPriority("MEDIUM");
    setDueDate("");
    setRequiresApproval(false);
    setIdempotencyKey(crypto.randomUUID());
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (!teamId) {
      toast({ title: "Please select a team", variant: "destructive" });
      return;
    }

    mutate({
      workspaceId,
      idempotencyKey,
      data: {
        title: title.trim(),
        description: description.trim(),
        requestType,
        priority,
        teamId,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        requiresApproval,
      },
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            Create Work Item
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="title" className="font-medium">
              Title <span className="text-red-500">*</span>
            </Label>
            <Input
              id="title"
              placeholder="e.g., Investigate high latency on payment gateway"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isPending}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description" className="font-medium">
              Description
            </Label>
            <Textarea
              id="description"
              placeholder="Detailed operational context, steps to reproduce, or incident notes..."
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="font-medium">
                Team <span className="text-red-500">*</span>
              </Label>
              <Select
                value={teamId}
                onValueChange={setTeamId}
                disabled={isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select team..." />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t._id} value={t._id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="font-medium">Request Type</Label>
              <Select
                value={requestType}
                onValueChange={setRequestType}
                disabled={isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="incident">Incident</SelectItem>
                  <SelectItem value="customer_issue">Customer Issue</SelectItem>
                  <SelectItem value="payment">Payment</SelectItem>
                  <SelectItem value="compliance">Compliance</SelectItem>
                  <SelectItem value="task">General Task</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="font-medium">Priority</Label>
              <Select
                value={priority}
                onValueChange={setPriority}
                disabled={isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="URGENT">Urgent (P0)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dueDate" className="font-medium">
                Due Date
              </Label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="flex items-center space-x-2 pt-2">
            <Checkbox
              id="requiresApproval"
              checked={requiresApproval}
              onCheckedChange={(checked) =>
                setRequiresApproval(checked === true)
              }
              disabled={isPending}
            />
            <Label
              htmlFor="requiresApproval"
              className="text-sm font-medium leading-none cursor-pointer"
            >
              Requires formal lead approval before resolution
            </Label>
          </div>

          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
