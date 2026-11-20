import { SetMetadata } from '@nestjs/common';

export const ALLOW_API_TOKEN = 'allowApiToken';

/**
 * Opens a controller, or a single route, to personal API tokens. A route
 * without this mark takes a login and nothing else. That is the default on
 * purpose: whatever gets added later, account settings above all, stays
 * closed to tokens until someone decides to open it. JwtAuthGuard does the
 * refusing.
 */
export const AllowApiToken = () => SetMetadata(ALLOW_API_TOKEN, true);
