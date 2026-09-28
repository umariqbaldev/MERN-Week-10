import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ParsePositiveIntPipe } from '../common/pipes/parse-positive-int.pipe';

/**
 * C5: Thin controller — every method is one service call plus a return.
 * Assignment 2: Write routes protected. GET routes are @Public().
 * Assignment 3 C3: All :id params validated with ParsePositiveIntPipe.
 */
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  /**
   * POST /tasks → 201
   * Requires membership on the target project (owner/admin/member).
   * W2 (Asgn2): creator_id comes from @CurrentUser(), not the body.
   */
  @Post()
  @Roles('owner', 'admin', 'member')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: { userId: number; email: string },
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasksService.create(dto, user.userId);
  }

  /** GET /tasks?status=&projectId=&assigneeId=&page=&pageSize= — public */
  @Public()
  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('projectId') projectId?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.tasksService.findAll({
      status,
      projectId: projectId ? Number(projectId) : undefined,
      assigneeId: assigneeId ? Number(assigneeId) : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /** GET /tasks/:id → 200 with relations, or 404 — public */
  @Public()
  @Get(':id')
  findOne(@Param('id', ParsePositiveIntPipe) id: number) {
    return this.tasksService.findOne(id);
  }

  /**
   * PATCH /tasks/:id → partial update, or 404
   * C1 (Asgn2): owner/admin/member of the project may update.
   * X1 (Asgn2): additional ownership check in service (creator or assignee only).
   */
  @Patch(':id')
  @Roles('owner', 'admin', 'member')
  update(
    @CurrentUser() user: { userId: number; email: string },
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksService.update(id, dto, user.userId);
  }

  /**
   * DELETE /tasks/:id → 204 No Content, or 404
   * Only owner or admin of the project may delete a task.
   */
  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParsePositiveIntPipe) id: number) {
    return this.tasksService.remove(id);
  }
}
