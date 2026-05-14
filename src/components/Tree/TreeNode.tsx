import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import type { ResourceNode } from "@/lib/db/types";
import { formatMinutes } from "@/lib/utils/time";
import { AvatarBadge } from "@/components/Profile/AvatarBadge";
import { useAssignmentStore } from "@/store/assignments";
import { useAuthStore } from "@/store/auth";
import { usePresenceStore } from "@/store/presence";
import { useProfileStore } from "@/store/profile";

interface TreeCallbacks {
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onLogWork: (id: string) => void;
  onStartRename: (id: string) => void;
  onCommitRename: (id: string, name: string) => void;
  onCancelRename: () => void;
  onDragStart: (id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
}

export interface TreeContext extends TreeCallbacks {
  expandedIds: Set<string>;
  selectedId: string | null;
  renamingId: string | null;
  draggingId: string | null;
  dropTargetId: string | null;
  /** IDs of ancestor nodes that should be shown at reduced opacity (0.5) when a filter is active */
  dimmedIds?: Set<string>;
}

interface Props extends TreeContext {
  node: ResourceNode;
  depth: number;
}

const TYPE_TITLE = {
  project: "Projekt",
  stage: "Etap",
  substage: "Podetap",
  task: "Zadanie",
};

const MAX_VISIBLE_ASSIGNEES = 3;

function shapeClass(type: ResourceNode["type"]): string {
  switch (type) {
    case "project":
      return "h-3.5 w-3.5 rounded-sm";
    case "stage":
      return "h-3 w-3 rounded-sm";
    case "substage":
      return "h-2.5 w-2.5 rounded-[2px]";
    case "task":
      return "h-2 w-2 rounded-[2px]";
  }
}

function shapeStyle(color: string): React.CSSProperties {
  return { backgroundColor: color };
}

export function TreeNode(props: Props) {
  const { node, depth, expandedIds, selectedId, renamingId, draggingId, dropTargetId, dimmedIds } = props;
  const expanded = expandedIds.has(node.id);
  const selected = selectedId === node.id;
  const renaming = renamingId === node.id;
  const isDropTarget = dropTargetId === node.id;
  const isDragging = draggingId === node.id;
  const isDimmed = dimmedIds?.has(node.id) ?? false;
  const hasChildren = node.children.length > 0;

  const getAssignees = useAssignmentStore((s) => s.getAssignees);
  const getProfile = useProfileStore((s) => s.getProfile);

  const assigneeIds = getAssignees(node.id);
  const visibleAssignees = assigneeIds.slice(0, MAX_VISIBLE_ASSIGNEES);
  const overflowCount = assigneeIds.length - visibleAssignees.length;

  // Faza 7 presence: other members currently editing this node.
  const presenceMembers = usePresenceStore((s) => s.members);
  const authState = useAuthStore((s) => s.state);
  const selfId = authState.kind === "authed" ? authState.user.id : null;
  const editors = presenceMembers.filter(
    (m) => m.editingResourceId === node.id && m.userId !== selfId,
  );

  return (
    <>
      <div
        draggable={!renaming}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", node.id);
          props.onDragStart(node.id);
        }}
        onDragOver={(e) => props.onDragOver(e, node.id)}
        onDrop={(e) => props.onDrop(e, node.id)}
        onDragEnd={props.onDragEnd}
        onClick={(e) => {
          if (renaming) return;
          if (e.detail >= 3) {
            props.onSelect(node.id);
            props.onStartRename(node.id);
            return;
          }
          if (e.detail !== 1) return;
          props.onSelect(node.id);
          if (hasChildren) props.onToggle(node.id);
        }}
        onContextMenu={(e) => props.onContextMenu(e, node.id)}
        className={`group flex cursor-default items-center gap-1 py-1 pr-2 text-sm transition-colors ${
          isDropTarget
            ? "bg-emerald-900/40 ring-1 ring-inset ring-emerald-500"
            : selected
              ? "bg-blue-900/40"
              : "hover:bg-neutral-800/60"
        } ${isDragging ? "opacity-40" : isDimmed ? "opacity-50" : ""}`}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        <span
          className={`flex h-4 w-4 items-center justify-center text-neutral-500 ${
            hasChildren ? "" : "invisible"
          }`}
          aria-hidden="true"
        >
          <span
            className="inline-block transition-transform"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            ▶
          </span>
        </span>

        <span
          className={`shrink-0 ${shapeClass(node.type)}`}
          style={shapeStyle(node.effective_color)}
          title={TYPE_TITLE[node.type]}
          aria-hidden="true"
        />

        {renaming ? (
          <RenameInput
            initial={node.name}
            onCommit={(v) => props.onCommitRename(node.id, v)}
            onCancel={props.onCancelRename}
          />
        ) : (
          <span className="flex-1 truncate text-neutral-100">{node.name}</span>
        )}

        {!renaming && editors.length > 0 && (
          <span
            className="ml-2 flex shrink-0 items-center gap-0.5"
            title={`Edytuje: ${editors.map((e) => e.displayName).join(", ")}`}
          >
            <Pencil size={11} className="text-amber-400" aria-hidden="true" />
            {editors.slice(0, 2).map((e) => (
              <AvatarBadge
                key={e.userId}
                userId={e.userId}
                displayName={e.displayName}
                avatarUrl={e.avatarUrl}
                size="xs"
              />
            ))}
          </span>
        )}

        {!renaming && node.cached_minutes > 0 && (
          <span className="ml-2 shrink-0 text-xs tabular-nums text-neutral-400">
            {formatMinutes(node.cached_minutes)}
          </span>
        )}

        {!renaming && assigneeIds.length > 0 && (
          <span className="ml-2 flex shrink-0 items-center gap-0.5">
            {visibleAssignees.map((userId) => {
              const profile = getProfile(userId);
              return (
                <AvatarBadge
                  key={userId}
                  userId={userId}
                  displayName={profile.display_name}
                  avatarUrl={profile.avatar_url}
                  size="xs"
                />
              );
            })}
            {overflowCount > 0 && (
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neutral-700 px-1 text-[9px] font-medium text-neutral-300">
                +{overflowCount}
              </span>
            )}
          </span>
        )}

        {!renaming && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              props.onLogWork(node.id);
            }}
            title="Loguj czas"
            className="ml-2 shrink-0 rounded p-1 text-neutral-500 opacity-0 transition-opacity hover:bg-neutral-700 hover:text-emerald-400 group-hover:opacity-100"
          >
            ▶
          </button>
        )}
      </div>

      {expanded &&
        node.children.map((child) => (
          <TreeNode key={child.id} {...props} node={child} depth={depth + 1} />
        ))}
    </>
  );
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.select();
  }, []);

  const submit = () => {
    const v = value.trim();
    if (!v || v === initial) {
      onCancel();
      return;
    }
    onCommit(v);
  };

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") submit();
        else if (e.key === "Escape") onCancel();
      }}
      onBlur={submit}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="flex-1 rounded border border-blue-500 bg-neutral-950 px-2 py-0.5 text-sm text-neutral-100 outline-none"
    />
  );
}
