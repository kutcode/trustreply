# Deploying TrustReply

TrustReply consists of two services:

- **Backend** -- FastAPI (Python 3.13) serving the API on port 8000
- **Frontend** -- Next.js 16 serving the UI on port 3000

Both have Dockerfiles ready to go. Pick either Railway (simplest) or Fly.io (more control).

---

## Prerequisites

| Item | Railway | Fly.io |
|------|---------|--------|
| Account | [railway.com](https://railway.com) | [fly.io](https://fly.io) |
| CLI | `npm i -g @railway/cli` | `brew install flyctl` or [docs](https://fly.io/docs/flyctl/install/) |
| Database | Provision a Railway Postgres plugin, or use Supabase | Provision `fly postgres create`, or use Supabase |

You will also need a **Supabase** project if you want authentication and/or a managed Postgres database.

---

## Environment Variables

Set these on whichever platform you deploy to. All are prefixed `QF_` for the backend.

### Backend

| Variable | Required | Description |
|----------|----------|-------------|
| `QF_DATABASE_URL` | Yes | Async DB URL, e.g. `postgresql+asyncpg://user:pass@host:5432/db` |
| `QF_SUPABASE_URL` | For auth | `https://xxxxx.supabase.co` |
| `QF_SUPABASE_ANON_KEY` | For auth | Supabase anon/public key |
| `QF_SUPABASE_SERVICE_KEY` | For auth | Supabase service role key |
| `QF_SUPABASE_JWT_SECRET` | For auth | JWT secret from Supabase dashboard |
| `QF_SIMILARITY_THRESHOLD` | No | Default `0.75` |
| `QF_CORS_ORIGINS` | Yes | JSON array, e.g. `["https://trustreply-frontend.up.railway.app"]` |
| `QF_AGENT_ENABLED` | No | `true` to enable LLM agent |
| `QF_AGENT_PROVIDER` | No | `openai` (default) |
| `QF_AGENT_API_BASE` | No | `https://api.openai.com/v1` |
| `QF_AGENT_API_KEY` | If agent | Your OpenAI (or compatible) API key |
| `QF_AGENT_MODEL` | No | `gpt-4.1-nano` (default) |
| `QF_API_KEY` | No | Optional shared API key for simple auth |

### Frontend (build args)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Yes | URL of the deployed backend, e.g. `https://trustreply-backend.up.railway.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | For auth | Same as backend `QF_SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | For auth | Same as backend `QF_SUPABASE_ANON_KEY` |

---

## Option 1: Railway (Recommended)

Railway deploys each service from its own directory. Each directory has a `railway.toml` that tells Railway to use the Dockerfile.

### Step 1: Install the CLI and log in

```bash
npm i -g @railway/cli
railway login
```

### Step 2: Create a project

```bash
railway init
```

### Step 3: Add a Postgres database (if not using Supabase)

In the Railway dashboard, click **+ New** inside your project and add **PostgreSQL**. Copy the connection string and convert it to async format:

```
postgresql+asyncpg://user:pass@host:port/dbname
```

### Step 4: Deploy the backend

```bash
cd backend
railway up
```

Then set environment variables in the Railway dashboard (Settings > Variables) for the backend service. At minimum set `QF_DATABASE_URL` and `QF_CORS_ORIGINS`.

### Step 5: Deploy the frontend

```bash
cd frontend
railway up
```

Set the frontend build variables in Railway dashboard. Make sure `NEXT_PUBLIC_API_URL` points to your backend's Railway URL.

### Step 6: Run migrations

```bash
railway run --service backend alembic upgrade head
```

### Step 7: Generate a domain

In the Railway dashboard, go to each service's **Settings > Networking** and click **Generate Domain** (or attach a custom domain).

---

## Option 2: Fly.io

Fly.io uses `fly.backend.toml` and `fly.frontend.toml` at the project root.

### Step 1: Install the CLI and log in

```bash
# macOS
brew install flyctl

# or
curl -L https://fly.io/install.sh | sh

fly auth login
```

### Step 2: Create a Postgres database (if not using Supabase)

```bash
fly postgres create --name trustreply-db
```

Save the connection string. Convert to async format:

```
postgresql+asyncpg://user:pass@trustreply-db.flycast:5432/dbname
```

### Step 3: Launch the backend

```bash
fly launch --config fly.backend.toml --no-deploy
```

Set secrets:

```bash
fly secrets set \
  QF_DATABASE_URL="postgresql+asyncpg://..." \
  QF_CORS_ORIGINS='["https://trustreply-frontend.fly.dev"]' \
  QF_SUPABASE_URL="https://xxxxx.supabase.co" \
  QF_SUPABASE_ANON_KEY="eyJ..." \
  QF_SUPABASE_SERVICE_KEY="eyJ..." \
  QF_SUPABASE_JWT_SECRET="your-jwt-secret" \
  --app trustreply-backend
```

Deploy:

```bash
fly deploy --config fly.backend.toml
```

### Step 4: Launch the frontend

```bash
fly launch --config fly.frontend.toml --no-deploy
```

Set build args (Fly uses `--build-arg` at deploy time):

```bash
fly deploy --config fly.frontend.toml \
  --build-arg NEXT_PUBLIC_API_URL=https://trustreply-backend.fly.dev \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

### Step 5: Run migrations

```bash
fly ssh console --app trustreply-backend -C "cd /app && alembic upgrade head"
```

### Step 6: Attach Postgres (if using Fly Postgres)

```bash
fly postgres attach trustreply-db --app trustreply-backend
```

---

## Running Alembic Migrations

After every deploy that includes model changes, run migrations:

**Railway:**
```bash
railway run --service backend alembic upgrade head
```

**Fly.io:**
```bash
fly ssh console --app trustreply-backend -C "cd /app && alembic upgrade head"
```

**Docker Compose (local):**
```bash
docker compose exec backend alembic upgrade head
```

To generate a new migration after changing models:
```bash
alembic revision --autogenerate -m "describe your change"
```

---

## Troubleshooting

### Backend fails health check

- Check logs: `railway logs` or `fly logs --app trustreply-backend`
- Ensure `QF_DATABASE_URL` is set and the database is reachable
- The health endpoint is `GET /api/health` -- it should return 200

### Frontend shows "Failed to fetch" or CORS errors

- Verify `QF_CORS_ORIGINS` on the backend includes the frontend's URL (with `https://`, no trailing slash)
- Verify `NEXT_PUBLIC_API_URL` on the frontend points to the backend's public URL
- Both values must use the same protocol (`https://`)

### Database connection refused

- Railway: make sure the Postgres plugin is in the same project, or that the Supabase URL is accessible
- Fly.io: make sure the Postgres app is running (`fly status --app trustreply-db`) and attached
- Check that the URL uses `postgresql+asyncpg://` (not `postgres://`)

### Build takes too long / OOM

- The backend Dockerfile downloads the `all-MiniLM-L6-v2` model (~80 MB) at build time. This is intentional to avoid cold-start delays
- Railway: if the build runs out of memory, upgrade to a plan with more build resources
- Fly.io: builder VMs have 8 GB RAM by default, which should be sufficient

### Alembic says "Target database is not up to date"

Run `alembic upgrade head` to apply pending migrations. If you see conflicts, run `alembic heads` to check for multiple heads and merge them with `alembic merge`.
