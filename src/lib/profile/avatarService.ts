import { supabase } from '@/lib/supabase';
import { getDb } from '@/lib/db/connection';

// ---- Constants ----

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_SIZE_BYTES = 256 * 1024; // 256 KB
const MAX_DIMENSION_PX = 2048;
const AVATAR_BUCKET = 'avatars';

// ---- Validation ----

/**
 * Validates an avatar file before upload.
 *
 * Requirements 2.2, 2.3, 2.4:
 * - Throws if the MIME type is not image/jpeg, image/png, or image/webp.
 *   The error message includes the rejected MIME type string.
 * - Throws if the file exceeds 256 KB.
 * - Throws if either image dimension exceeds 2048 pixels.
 *
 * Returns a Promise because dimension checking requires async image loading.
 */
export async function validateAvatarFile(file: File): Promise<void> {
  // Check MIME type
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new Error(
      `Unsupported file format: ${file.type}. Please upload a JPEG, PNG, or WebP image.`,
    );
  }

  // Check file size
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error('Avatar must be at most 256 KB.');
  }

  // Check image dimensions
  await checkImageDimensions(file);
}

/**
 * Loads the file as an image and checks that neither dimension exceeds 2048px.
 * Throws if the image cannot be loaded or dimensions are too large.
 */
function checkImageDimensions(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth > MAX_DIMENSION_PX || img.naturalHeight > MAX_DIMENSION_PX) {
        reject(new Error('Avatar dimensions must not exceed 2048×2048 pixels.'));
      } else {
        resolve();
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to read image dimensions.'));
    };

    img.src = url;
  });
}

// ---- Upload ----

/**
 * Validates the file, uploads it to the Supabase Storage `avatars` bucket,
 * deletes the old avatar (non-fatal on failure), updates `profiles.avatar_url`
 * in Supabase, and mirrors the new URL to the local `profiles_cache`.
 *
 * Requirements 2.1, 2.5, 2.7:
 * - Validates before any network request.
 * - Stores the image at `{userId}/{uuid}.{ext}` in the `avatars` bucket.
 * - Deletes the previous avatar file if one exists (failure is logged, not thrown).
 * - Updates `profiles.avatar_url` and the local cache.
 * - Returns the public URL of the newly uploaded avatar.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  await validateAvatarFile(file);

  if (!supabase) {
    throw new Error('Supabase is not configured — cannot upload avatar.');
  }

  // Determine file extension from MIME type
  const ext = mimeToExt(file.type);
  const filename = `${crypto.randomUUID()}.${ext}`;
  const storagePath = `${userId}/${filename}`;

  // Upload new avatar
  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    throw new Error(`Failed to upload avatar: ${uploadError.message}`);
  }

  // Get the public URL
  const { data: urlData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(storagePath);
  const newUrl = urlData.publicUrl;

  // Fetch the existing profile (display_name + avatar_url) so we can delete
  // the old file AND preserve display_name (NOT NULL in Supabase).
  const { data: profileData } = await supabase
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('user_id', userId)
    .maybeSingle();

  const oldAvatarUrl: string | null = profileData?.avatar_url ?? null;

  // Determine display_name for upsert — Supabase requires NOT NULL.
  // Prefer existing value; fall back to email prefix from the current session.
  let displayName = profileData?.display_name ?? null;
  if (!displayName) {
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email ?? '';
    displayName = email.split('@')[0] || userId;
  }

  // Update profiles.avatar_url in Supabase
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('profiles')
    .upsert(
      {
        user_id: userId,
        display_name: displayName,
        avatar_url: newUrl,
        updated_at: now,
      },
      { onConflict: 'user_id' },
    );

  if (updateError) {
    throw new Error(`Failed to update profile avatar URL: ${updateError.message}`);
  }

  // Update local cache
  const db = await getDb();
  await db.execute(
    `INSERT INTO profiles_cache (user_id, display_name, avatar_url, cached_at)
     VALUES ($1, COALESCE((SELECT display_name FROM profiles_cache WHERE user_id = $1), ''), $2, $3)
     ON CONFLICT(user_id) DO UPDATE
       SET avatar_url = excluded.avatar_url,
           cached_at  = excluded.cached_at`,
    [userId, newUrl, Date.now()],
  );

  // Delete old avatar file (non-fatal)
  if (oldAvatarUrl) {
    const oldPath = extractStoragePath(oldAvatarUrl, AVATAR_BUCKET);
    if (oldPath) {
      supabase.storage
        .from(AVATAR_BUCKET)
        .remove([oldPath])
        .catch((err: unknown) => {
          console.warn('[avatarService] Failed to delete old avatar:', err);
        });
    }
  }

  return newUrl;
}

// ---- Fallback helpers ----

/**
 * Generates fallback initials from a display name.
 *
 * Requirement 2.6:
 * - Returns up to 2 uppercase characters.
 * - First character: first letter of the first word.
 * - Second character (if a second word exists): first letter of the last word.
 * - Returns an empty string for an empty display name.
 */
export function getInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return '';

  const first = (words[0] ?? '').charAt(0).toUpperCase();
  if (words.length === 1) return first;

  const last = (words[words.length - 1] ?? '').charAt(0).toUpperCase();
  return first + last;
}

/**
 * Generates a deterministic hex background color from a user_id string.
 *
 * Requirement 2.6:
 * - The same user_id always produces the same color.
 * - Uses a simple djb2-style hash over the character codes.
 * - Returns a 6-digit hex color string prefixed with '#'.
 */
export function getAvatarColor(userId: string): string {
  let hash = 5381;
  for (let i = 0; i < userId.length; i++) {
    // hash * 33 ^ charCode  (djb2 variant)
    hash = ((hash << 5) + hash) ^ userId.charCodeAt(i);
    // Keep within 32-bit signed integer range
    hash = hash | 0;
  }
  // Convert to unsigned and take lower 24 bits for RGB
  const color = (hash >>> 0) & 0xffffff;
  return '#' + color.toString(16).padStart(6, '0');
}

// ---- Internal utilities ----

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}

/**
 * Extracts the storage path from a Supabase public URL.
 * e.g. "https://<project>.supabase.co/storage/v1/object/public/avatars/userId/file.jpg"
 * → "userId/file.jpg"
 *
 * Returns null if the URL does not contain the expected bucket segment.
 */
function extractStoragePath(publicUrl: string, bucket: string): string | null {
  const marker = `/object/public/${bucket}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
}
