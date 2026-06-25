import { SetMetadata } from '@nestjs/common';

export const ALLOW_INCOMPLETE_PROFILE_KEY = 'allowIncompleteProfile';

/**
 * Marks a handler (or controller) as reachable even when the current customer
 * has not yet set their name. Used to whitelist the profile read/update
 * endpoints so a nameless customer can complete their profile — every other
 * protected route is gated by {@link ProfileCompleteGuard}.
 */
export const AllowIncompleteProfile = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(ALLOW_INCOMPLETE_PROFILE_KEY, true);
