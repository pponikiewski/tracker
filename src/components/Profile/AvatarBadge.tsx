import { getInitials, getAvatarColor } from '@/lib/profile/avatarService';

export interface AvatarBadgeProps {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  size?: 'xs' | 'sm' | 'md';
}

const SIZE_CLASSES: Record<NonNullable<AvatarBadgeProps['size']>, string> = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
};

/**
 * Renders a user avatar as either an <img> (when avatarUrl is provided) or a
 * deterministic initials badge (fallback). Supports three sizes: xs, sm, md.
 *
 * Requirements: 2.6, 4.1, 5.9
 */
export function AvatarBadge({ userId, displayName, avatarUrl, size = 'sm' }: AvatarBadgeProps) {
  const sizeClass = SIZE_CLASSES[size];

  // Guard against empty strings / whitespace (would cause <img src=""> to fire
  // a request to the page origin and produce confusing 404s).
  const safeUrl =
    typeof avatarUrl === 'string' && avatarUrl.trim().length > 0 ? avatarUrl : null;

  if (safeUrl) {
    return (
      <img
        src={safeUrl}
        alt={displayName}
        className={`${sizeClass} rounded-full object-cover shrink-0`}
      />
    );
  }

  const initials = getInitials(displayName);
  const bgColor = getAvatarColor(userId);

  return (
    <span
      className={`${sizeClass} inline-flex items-center justify-center rounded-full shrink-0 font-medium leading-none select-none text-white`}
      style={{ backgroundColor: bgColor }}
      aria-label={displayName}
      title={displayName}
    >
      {initials}
    </span>
  );
}
