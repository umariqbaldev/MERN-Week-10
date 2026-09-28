import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ParsePositiveIntPipe } from '../common/pipes/parse-positive-int.pipe';

/**
 * W2 + C4 (Asgn2): Thin controller — nested under /tasks/:taskId/comments.
 * Assignment 3 C3: All :taskId params validated with ParsePositiveIntPipe.
 */
@Controller('tasks/:taskId/comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  /**
   * POST /tasks/:taskId/comments → 201
   * W2 (Asgn2): author_id comes from @CurrentUser(), not the body.
   * C1 (Asgn2): Must be at least a member on the task's project.
   */
  @Post()
  @Roles('owner', 'admin', 'member')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: { userId: number; email: string },
    @Param('taskId', ParsePositiveIntPipe) taskId: number,
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentsService.create(taskId, dto, user.userId);
  }

  /** GET /tasks/:taskId/comments?page=&pageSize= → paginated — public */
  @Public()
  @Get()
  findByTask(
    @Param('taskId', ParsePositiveIntPipe) taskId: number,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.commentsService.findByTask(taskId, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }
}
