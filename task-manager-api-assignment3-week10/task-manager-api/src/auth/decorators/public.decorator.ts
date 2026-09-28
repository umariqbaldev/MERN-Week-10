import { SetMetadata } from '@nestjs/common';

/**
 * X2: Mark a route as public — JwtAuthGuard skips it.
 * Used on login, register, refresh, and read-only GET routes.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
