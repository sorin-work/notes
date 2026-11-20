import { SetMetadata } from '@nestjs/common';

export const SESSION_ONLY = 'sessionOnly';

/**
 * The route, or every route of the controller, takes a login and refuses an
 * API token: managing the account and the tokens themselves. JwtAuthGuard
 * does the refusing.
 */
export const SessionOnly = () => SetMetadata(SESSION_ONLY, true);

/** Opens one route of a @SessionOnly() controller to API tokens again. */
export const AllowApiToken = () => SetMetadata(SESSION_ONLY, false);
