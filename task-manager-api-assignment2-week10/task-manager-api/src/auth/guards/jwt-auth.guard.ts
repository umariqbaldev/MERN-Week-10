import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * W1 + X2: JWT authentication guard.
 * Applied GLOBALLY — every route requires a valid Bearer token unless
 * decorated with @Public().
 *
 * C4: Must run before RolesGuard so unauthenticated requests get 401, not 403.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // X2: Check if route is marked @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Delegate to passport-jwt — returns 401 on invalid/missing token
    return super.canActivate(context);
  }
}
