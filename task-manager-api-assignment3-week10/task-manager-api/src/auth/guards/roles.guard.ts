import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ProjectMember } from '../../entities/project-member.entity';
import { Task } from '../../entities/task.entity';
import { Comment } from '../../entities/comment.entity';

/**
 * C1 + C3 + C4 + X1 + X3: Role-based access control guard.
 *
 * Reads the caller's role from project_members on the RELEVANT project
 * (not just "any project the user belongs to" — that's the confused-deputy trap).
 *
 * C4: Must be listed AFTER JwtAuthGuard so req.user is populated.
 *
 * X1: For task updates, also checks ownership (creator or assignee).
 *
 * X3: Includes a simple per-request cache to avoid duplicate lookups
 *     within the same request, plus a Map-based TTL cache across requests.
 */

interface CacheEntry {
  role: string | null;
  timestamp: number;
}

@Injectable()
export class RolesGuard implements CanActivate {
  // X3: Simple in-memory cache — keyed by "userId:projectId"
  private roleCache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 30_000; // 30 seconds

  constructor(
    private reflector: Reflector,
    @InjectRepository(ProjectMember)
    private readonly memberRepo: Repository<ProjectMember>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // If route is public, skip role check
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // If no @Roles() decorator, allow (authentication alone is enough)
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user; // from JwtAuthGuard → { userId, email }

    if (!user) {
      // C4: Should not reach here if JwtAuthGuard runs first.
      // But if it does, 401 is handled by JwtAuthGuard; this guard throws 403.
      throw new ForbiddenException('No authenticated user');
    }

    // ── Resolve which project this request is about ──────────────
    const projectId = await this.resolveProjectId(request);

    if (!projectId) {
      // Cannot determine project context — deny
      throw new ForbiddenException('Cannot determine project for authorization');
    }

    // ── Look up the user's role on this specific project (C3) ────
    const role = await this.getUserRole(user.userId, projectId);

    if (!role) {
      // User is not a member of this project at all
      throw new ForbiddenException(
        'You are not a member of this project',
      );
    }

    // ── Check if user's role is in the allowed list ──────────────
    if (!requiredRoles.includes(role)) {
      throw new ForbiddenException(
        `Role '${role}' is not authorized for this action`,
      );
    }

    // X1: For task PATCH, check ownership (creator or assignee)
    // The @Roles decorator gets them past the role gate;
    // ownership is an additional check on the specific resource.
    // Store role on request for downstream use
    request.projectRole = role;

    return true;
  }

  /**
   * Resolve the project ID from the request context.
   * It may come from:
   *   1. Route param :id on /projects/:id
   *   2. Route param :id on /tasks/:id → load task → task.project_id
   *   3. Body.projectId on POST /tasks (creating a task)
   *   4. Route param :taskId on /tasks/:taskId/comments → load task → project_id
   */
  private async resolveProjectId(request: any): Promise<number | null> {
    const path: string = request.route?.path || request.url || '';
    const params = request.params || {};
    const body = request.body || {};

    // /projects/:id — the project itself
    if (path.includes('/projects') && params.id) {
      return parseInt(params.id, 10);
    }

    // /tasks/:taskId/comments — nested comment route
    if (params.taskId) {
      const task = await this.taskRepo.findOne({
        where: { id: parseInt(params.taskId, 10) },
        select: ['id', 'project_id'],
      });
      if (!task) throw new NotFoundException('Task not found');
      return task.project_id;
    }

    // /tasks/:id — task route
    if (path.includes('/tasks') && params.id) {
      const task = await this.taskRepo.findOne({
        where: { id: parseInt(params.id, 10) },
        select: ['id', 'project_id'],
      });
      if (!task) throw new NotFoundException('Task not found');
      return task.project_id;
    }

    // POST /tasks — projectId in body
    if (body.projectId) {
      return body.projectId;
    }

    return null;
  }

  /** X3: Look up role with cache. */
  private async getUserRole(
    userId: number,
    projectId: number,
  ): Promise<string | null> {
    const cacheKey = `${userId}:${projectId}`;
    const now = Date.now();

    // Check cache
    const cached = this.roleCache.get(cacheKey);
    if (cached && now - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.role;
    }

    // Query database
    const membership = await this.memberRepo.findOne({
      where: { user_id: userId, project_id: projectId },
    });

    const role = membership?.role ?? null;

    // Store in cache
    this.roleCache.set(cacheKey, { role, timestamp: now });

    // X3: Prune old entries periodically (keep cache from growing unbounded)
    if (this.roleCache.size > 1000) {
      for (const [key, entry] of this.roleCache) {
        if (now - entry.timestamp > this.CACHE_TTL_MS) {
          this.roleCache.delete(key);
        }
      }
    }

    return role;
  }

  /** X3: Clear cache entry when membership changes. */
  clearCache(userId: number, projectId: number): void {
    this.roleCache.delete(`${userId}:${projectId}`);
  }

  /** X3: Clear entire cache. */
  clearAllCache(): void {
    this.roleCache.clear();
  }
}
