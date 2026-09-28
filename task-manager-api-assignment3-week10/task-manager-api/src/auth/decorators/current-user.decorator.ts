import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * W2: Extract the authenticated user from the request.
 * JwtAuthGuard + JwtStrategy attach { userId, email } to req.user.
 * A userId in the request body is a claim from the client — the token
 * is the only identity you have verified.
 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user; // { userId: number, email: string }
  },
);
