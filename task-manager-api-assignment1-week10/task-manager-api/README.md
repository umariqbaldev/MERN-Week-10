# Task Manager API

**Week 8 — Assignments 2 & 3: Tasks, Projects & Comments CRUD**

A NestJS REST API for managing tasks, projects, and comments. Built on the 7-table domain schema from Phase 3 (users, projects, project_members, tasks, tags, task_tags, comments).

## Prerequisites

- Node.js >= 18
- PostgreSQL with the Phase 3 `taskmgr` database and migrations applied
- npm >= 9

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy .env.example to .env and fill in your database credentials
cp .env.example .env

# 3. Run unit tests (no database needed)
npm test

# 4. Start the app (requires PostgreSQL from .env)
npm run start

# 5. Hit the health endpoint
curl http://localhost:3000/health/db
```

## API Endpoints

### Health

| Method | Path          | Status | Description               |
|--------|---------------|--------|---------------------------|
| GET    | `/health/db`  | 200    | Database health check     |

### Projects

| Method | Path              | Status | Description               |
|--------|-------------------|--------|---------------------------|
| POST   | `/projects`       | 201    | Create a new project      |
| GET    | `/projects`       | 200    | List projects (paginated) |
| GET    | `/projects/:id`   | 200    | Get a single project      |
| PATCH  | `/projects/:id`   | 200    | Partial update a project  |
| DELETE | `/projects/:id`   | 204    | Delete a project (cascade)|

### Tasks

| Method | Path          | Status | Description               |
|--------|---------------|--------|---------------------------|
| POST   | `/tasks`      | 201    | Create a new task         |
| GET    | `/tasks`      | 200    | List tasks (with filters) |
| GET    | `/tasks/:id`  | 200    | Get a single task         |
| PATCH  | `/tasks/:id`  | 200    | Partial update a task     |
| DELETE | `/tasks/:id`  | 204    | Delete a task             |

### Comments (nested under tasks)

| Method | Path                          | Status | Description                    |
|--------|-------------------------------|--------|--------------------------------|
| POST   | `/tasks/:taskId/comments`     | 201    | Create a comment on a task     |
| GET    | `/tasks/:taskId/comments`     | 200    | List comments for a task       |

---

## Endpoint Details

### POST /projects

Create a new project.

**Request body:**

```json
{
  "name": "My Project",      // required, min 3 chars
  "ownerId": 1               // required, must exist in users
}
```

**Response:** 201 Created — the project with `owner` relation loaded.

**Errors:**
- 400 — Validation failure (missing/invalid fields, unknown fields rejected)
- 404 — Referenced owner (user) does not exist

### GET /projects

List projects with pagination.

**Query parameters:**

| Param      | Type   | Description                              |
|------------|--------|------------------------------------------|
| `page`     | number | Page number (default: 1)                 |
| `pageSize` | number | Items per page (default: 20, max: 100)   |

**Response:** 200 OK — `{ items, total, page }`

### PATCH /projects/:id

Partial update. Only the fields you send are changed.

**Request body:** Any subset of the POST body fields.

**Response:** 200 OK — updated project with owner.

**Errors:** 404 — Project or new owner not found

### DELETE /projects/:id

Delete a project. Database ON DELETE CASCADE removes child tasks and comments automatically (C2).

**Response:** 204 No Content (empty body).

---

### POST /tasks

Create a new task.

**Request body:**

```json
{
  "title": "Implement login page",        // required, min 3 chars
  "description": "Build the login UI",    // optional
  "status": "todo",                       // optional, enum: todo | in_progress | done (default: todo)
  "priority": 3,                          // optional, int 1-5 (default: 3)
  "projectId": 1,                         // required, must exist
  "assigneeId": 2,                        // optional, must exist if provided
  "tagIds": [1, 3]                        // optional, array of tag ids
}
```

**Response:** 201 Created — the created task with `project`, `assignee`, `tags` relations and `commentCount` loaded.

**Errors:**
- 400 — Validation failure (missing/invalid fields, unknown fields rejected)
- 404 — Referenced project or assignee does not exist

### GET /tasks

List tasks with optional filters and pagination.

**Query parameters:**

| Param       | Type   | Description                              |
|-------------|--------|------------------------------------------|
| `status`    | string | Filter by status (todo, in_progress, done) |
| `projectId` | number | Filter by project                        |
| `assigneeId`| number | Filter by assignee                       |
| `page`      | number | Page number (default: 1)                 |
| `pageSize`  | number | Items per page (default: 20, max: 100)   |

**Response:** 200 OK — `{ items, total, page }`

All filters are combinable — pass any subset together.

### GET /tasks/:id

Fetch a single task with `project`, `assignee`, `tags` relations and `commentCount` (X2: count without loading all comments).

**Response:** 200 OK — full task object.

**Errors:** 400 — Non-numeric `:id`, 404 — Task not found

### PATCH /tasks/:id

Partial update. Only the fields you send are changed.

**Response:** 200 OK — updated task with relations.

**Errors:** 400, 404

### DELETE /tasks/:id

Delete a task.

**Response:** 204 No Content (empty body).

---

### POST /tasks/:taskId/comments

Create a comment on a task. Task id comes from the URL path.

**Request body:**

```json
{
  "body": "Looks good!",     // required, non-empty
  "authorId": 2              // required, must exist in users
}
```

**Response:** 201 Created — the comment with `author` relation loaded.

**Errors:**
- 400 — Validation failure
- 404 — Task or author does not exist (C1: 404 not 500)

### GET /tasks/:taskId/comments

List comments for a task with pagination.

**Query parameters:**

| Param      | Type   | Description                              |
|------------|--------|------------------------------------------|
| `page`     | number | Page number (default: 1)                 |
| `pageSize` | number | Items per page (default: 20, max: 100)   |

**Response:** 200 OK — `{ items, total, page }`

---

## Error Response Shape

All errors follow a uniform structure (X2 — global exception filter):

```json
{
  "statusCode": 404,
  "message": "Task with id 999 not found",
  "path": "/tasks/999",
  "timestamp": "2026-01-15T12:00:00.000Z"
}
```

## Project Structure

```
src/
├── app.module.ts           # Root module
├── main.ts                 # Bootstrap (global pipes + filters)
├── common/
│   └── filters/
│       └── http-exception.filter.ts   # X2: Global exception filter
├── entities/
│   ├── user.entity.ts
│   ├── project.entity.ts
│   ├── project-member.entity.ts
│   ├── task.entity.ts      # TaskStatus enum exported
│   ├── tag.entity.ts
│   ├── comment.entity.ts
│   └── index.ts            # Barrel export
├── projects/
│   ├── projects.module.ts
│   ├── projects.controller.ts          # Thin controller
│   ├── projects.service.ts             # CRUD + owner validation
│   ├── projects.controller.spec.ts     # Integration tests
│   ├── projects.service.spec.ts        # Unit tests
│   ├── cascade-delete.spec.ts          # C2: cascade delete test
│   └── dto/
│       ├── create-project.dto.ts       # class-validator decorators
│       └── update-project.dto.ts       # PartialType(CreateProjectDto)
├── tasks/
│   ├── tasks.module.ts
│   ├── tasks.controller.ts             # Thin controller
│   ├── tasks.service.ts                # CRUD + relation validation + commentCount
│   ├── tasks.controller.spec.ts        # Integration tests
│   ├── tasks.service.spec.ts           # Unit tests
│   └── dto/
│       ├── create-task.dto.ts          # class-validator decorators
│       └── update-task.dto.ts          # PartialType(CreateTaskDto)
├── comments/
│   ├── comments.module.ts
│   ├── comments.controller.ts          # Thin controller (nested route)
│   ├── comments.service.ts             # Create + paginated list
│   ├── comments.controller.spec.ts     # Integration tests
│   ├── comments.service.spec.ts        # Unit tests
│   └── dto/
│       └── create-comment.dto.ts       # class-validator decorators
├── users/
│   └── users.module.ts
├── health/                 # Assignment 1
├── notification/           # Assignment 1
├── shared/                 # Assignment 1
└── task/                   # Assignment 1 (X2 circular dep demo)
```

## Tests

```bash
npm test          # Run all tests
npm run test:cov  # Run with coverage report
```

**12 test suites, 86 tests:**
- `projects.controller.spec.ts` — Integration tests (POST, GET, PATCH, DELETE, 400, 404)
- `projects.service.spec.ts` — Unit tests (create, findOne, findAll, update, remove)
- `cascade-delete.spec.ts` — C2: proves cascade delete calls remove()
- `comments.controller.spec.ts` — Integration tests (nested route POST, GET, 400, 404)
- `comments.service.spec.ts` — Unit tests (create with validation, paginated list)
- `tasks.controller.spec.ts` — Integration tests (C6 happy path + X3 error paths)
- `tasks.service.spec.ts` — Unit tests (CRUD + X2 commentCount via query builder)
- `health.controller.spec.ts` — Health controller tests
- `health.service.spec.ts` — Health service tests with mocked repos
- `task.service.spec.ts` — Circular dependency demo tests
- `notification.service.spec.ts` — Notification service tests
- `logger.service.spec.ts` — Shared logger tests

## Acceptance Criteria Checklist

### Assignment 2 (Tasks)

- [x] **W1** — ConfigModule.forRoot with Joi validation reads .env
- [x] **W2** — TypeOrmModule.forRootAsync from ConfigService; Task entity with CRUD
- [x] **C1** — class-validator decorators: `@MinLength(3)`, `@IsEnum`, `@IsInt`, `@Min`, `@Max`
- [x] **C2** — `GET /tasks?status=&projectId=&assigneeId=` — combinable query builder filters
- [x] **C3** — `PATCH /tasks/:id` partial update via `PartialType(CreateTaskDto)`
- [x] **C4** — Relation validation: 404 (not 500) when projectId/assigneeId don't exist
- [x] **C5** — Thin controller: no Repository/DataSource in TasksController
- [x] **C6** — Integration test with supertest: POST→201 happy path + 400 validation failure
- [x] **C7** — README with all endpoints, methods, paths, status codes, filter params
- [x] **X1** — Pagination: `page`, `pageSize` query params with defaults + capped max
- [x] **X2** — Global exception filter: uniform `{ statusCode, message, path, timestamp }`
- [x] **X3** — Error-path tests: unknown id→404, unknown field→400, delete→204

### Assignment 3 (Projects & Comments)

- [x] **W1** — Projects full CRUD (POST 201, GET list, GET :id, PATCH, DELETE 204)
- [x] **W2** — Comments nested under `/tasks/:taskId/comments` (POST + GET)
- [x] **C1** — Validate parent task exists before saving comment (404, not FK 500)
- [x] **C2** — Cascade delete: removing a project deletes its tasks and their comments
- [x] **C3** — Unit tests for ProjectsService and CommentsService (mock repos, known rows)
- [x] **X1** — Field-by-field mapping assertion in unit tests
- [x] **X2** — `commentCount` on GET /tasks/:id without loading every comment row
- [x] **X3** — Paginated comments list: `{ items, total, page }` shape
- [x] **No `any`** in src/ (TypeScript strict types)
- [x] **No Repository in controllers** — service-only pattern
