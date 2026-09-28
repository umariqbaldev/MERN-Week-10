import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { ProjectMember } from './project-member.entity';
import { Comment } from './comment.entity';
import { Project } from './project.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  password_hash: string;

  @CreateDateColumn()
  created_at: Date;

  @OneToMany(() => Project, (p) => p.owner)
  owned_projects: Project[];

  @OneToMany(() => ProjectMember, (pm) => pm.user)
  memberships: ProjectMember[];

  @OneToMany(() => Comment, (c) => c.author)
  comments: Comment[];
}
