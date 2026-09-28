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
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ParsePositiveIntPipe } from '../common/pipes/parse-positive-int.pipe';

/**
 * W1 + C4: Thin controller — every method is one service call plus a return.
 * Assignment 2: Write routes protected by JwtAuthGuard (global) + RolesGuard.
 * Assignment 3 C3: All :id params validated with ParsePositiveIntPipe.
 * GET routes are @Public().
 */
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * POST /projects → 201
   * W2 (Asgn2): Uses @CurrentUser() as the owner — ignores body ownerId.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: { userId: number; email: string },
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsService.create(dto, user.userId);
  }

  /** GET /projects?page=&pageSize= — public */
  @Public()
  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.projectsService.findAll({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /** GET /projects/:id → 200 with owner, or 404 — public */
  @Public()
  @Get(':id')
  findOne(@Param('id', ParsePositiveIntPipe) id: number) {
    return this.projectsService.findOne(id);
  }

  /**
   * PATCH /projects/:id → partial update, or 404
   * C1 (Asgn2): Only owner, admin, or member may update.
   */
  @Patch(':id')
  @Roles('owner', 'admin', 'member')
  update(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(id, dto);
  }

  /**
   * DELETE /projects/:id → 204 No Content, or 404
   * C2 (Asgn2): Only owner or admin may delete a project.
   */
  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParsePositiveIntPipe) id: number) {
    return this.projectsService.remove(id);
  }
}
