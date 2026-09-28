import { SetMetadata } from '@nestjs/common';

/**
 * C1: Set the minimum required roles for a route.
 * Roles are: owner, admin, member, viewer.
 * Usage: @Roles('owner', 'admin') — means only owner or admin may proceed.
 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
