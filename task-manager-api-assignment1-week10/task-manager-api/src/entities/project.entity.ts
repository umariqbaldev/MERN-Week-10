import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { ProjectMember } from './project-member.entity';
import { Task } from './task.entity';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  owner_id: number;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => User, (u) => u.owned_projects)
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @OneToMany(() => ProjectMember, (pm) => pm.project)
  members: ProjectMember[];

  @OneToMany(() => Task, (t) => t.project)
  tasks: Task[];
}
