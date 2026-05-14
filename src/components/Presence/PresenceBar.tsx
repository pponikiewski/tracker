import { AvatarBadge } from "@/components/Profile/AvatarBadge";
import { useAuthStore } from "@/store/auth";
import { usePresenceStore } from "@/store/presence";

/**
 * Faza 7 — sidebar row of avatars for everyone currently online in the active
 * workspace. A green dot marks live presence. Hidden when nobody is online
 * (e.g. before the presence channel has synced).
 */
export function PresenceBar() {
  const members = usePresenceStore((s) => s.members);
  const authState = useAuthStore((s) => s.state);
  const selfId = authState.kind === "authed" ? authState.user.id : null;

  if (members.length === 0) return null;

  return (
    <div className="px-1">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
        Online ({members.length})
      </div>
      <div className="flex flex-wrap gap-1">
        {members.map((m) => (
          <div
            key={m.userId}
            className="relative"
            title={m.userId === selfId ? `${m.displayName} (Ty)` : m.displayName}
          >
            <AvatarBadge
              userId={m.userId}
              displayName={m.displayName}
              avatarUrl={m.avatarUrl}
              size="xs"
            />
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-neutral-950 bg-emerald-500" />
          </div>
        ))}
      </div>
    </div>
  );
}
