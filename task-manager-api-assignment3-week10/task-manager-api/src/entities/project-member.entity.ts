import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  PrimaryColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Project } from './project.entity';

@Entity('project_members')
export class ProjectMember {
  @PrimaryColumn()
  user_id: number;

  @PrimaryColumn()
  project_id: number;

  @Column({ type: 'varchar', default: 'member' })
  role: string; // owner | admin | member | viewer

  @ManyToOne(() => User, (u) => u.memberships)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Project, (p) => p.members)
  @JoinColumn({ name: 'project_id' })
  project: Project;
}
