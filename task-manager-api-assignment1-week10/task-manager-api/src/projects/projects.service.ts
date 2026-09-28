import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../entities/project.entity';
import { User } from '../entities/user.entity';
import { ProjectMember } from '../entities/project-member.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

export interface PaginatedProjects {
  items: Project[];
  total: number;
  page: number;
}

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(ProjectMember)
    private readonly memberRepository: Repository<ProjectMember>,
  ) {}

  /** C4: Validate that the owner exists before saving. */
  private async validateOwner(ownerId: number): Promise<void> {
    const user = await this.userRepository.findOneBy({ id: ownerId });
    if (!user) {
      throw new NotFoundException(`User (owner) with id ${ownerId} not found`);
    }
  }

  /**
   * W1 + W2: Create a project.
   * The owner comes from @CurrentUser (userId), not from the body.
   * Also auto-creates a project_member row with role 'owner'.
   */
  async create(dto: CreateProjectDto, userId: number): Promise<Project> {
    await this.validateOwner(userId);

    const project = this.projectRepository.create({
      name: dto.name,
      owner_id: userId, // W2: use authenticated user, not body
    });

    const saved = await this.projectRepository.save(project);

    // Auto-create project_member with role 'owner' so RolesGuard works
    const membership = this.memberRepository.create({
      user_id: userId,
      project_id: saved.id,
      role: 'owner',
    });
    await this.memberRepository.save(membership);

    return this.findOne(saved.id);
  }

  /** W1: Find one project with owner relation loaded. 404 if missing. */
  async findOne(id: number): Promise<Project> {
    const project = await this.projectRepository.findOne({
      where: { id },
      relations: ['owner'],
    });

    if (!project) {
      throw new NotFoundException(`Project with id ${id} not found`);
    }

    return project;
  }

  /** W1: List projects with pagination. */
  async findAll(query: { page?: number; pageSize?: number }): Promise<PaginatedProjects> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0
      ? Math.min(query.pageSize, 100)
      : 20;

    const [items, total] = await this.projectRepository.findAndCount({
      relations: ['owner'],
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { created_at: 'DESC' },
    });

    return { items, total, page };
  }

  /** W1: Partial update. 404 if missing. */
  async update(id: number, dto: UpdateProjectDto): Promise<Project> {
    const project = await this.findOne(id); // throws 404

    if (dto.ownerId !== undefined) {
      await this.validateOwner(dto.ownerId);
      project.owner_id = dto.ownerId;
    }

    if (dto.name !== undefined) {
      project.name = dto.name;
    }

    await this.projectRepository.save(project);
    return this.findOne(id);
  }

  /**
   * C2: Delete with cascade.
   * The database ON DELETE CASCADE removes child tasks and comments.
   */
  async remove(id: number): Promise<void> {
    const project = await this.projectRepository.findOneBy({ id });
    if (!project) {
      throw new NotFoundException(`Project with id ${id} not found`);
    }
    await this.projectRepository.remove(project);
  }
}
