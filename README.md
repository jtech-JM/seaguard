# SEAGUARD — Marine Rescue Coordination Platform

A real-time maritime operations platform connecting fishermen, Beach Management Units (BMUs), and rescue officers. Fishermen carry an SOS device at sea; one button press triggers an instant alarm on the rescue dashboard with live GPS tracking.

---

## Tech Stack

| Layer     | Technology                                       |
| --------- | ------------------------------------------------ |
| Framework | TanStack Start (React + SSR)                     |
| Routing   | TanStack Router (file-based)                     |
| Database  | Supabase (PostgreSQL + Realtime)                 |
| Auth      | Supabase Auth (email/password + Google OAuth)    |
| Styling   | Tailwind CSS v4                                  |
| Map       | Leaflet (CartoDB dark tiles — no API key needed) |
| Build     | Vite + Bun                                       |
| Deploy    | Cloudflare Workers (via Nitro)                   |

---

## Roles

| Role             | Dashboard    | Access                                                    |
| ---------------- | ------------ | --------------------------------------------------------- |
| `admin`          | `/admin`     | User & role management, fisherman account linking         |
| `bmu_officer`    | `/bmu`       | Register fishermen, boats, SOS devices; approve sea trips |
| `rescue_officer` | `/rescue`    | Live SOS incident queue, GPS map, rescue operations       |
| `fisherman`      | `/fisherman` | Sea trip check-in/out, device status, trip history        |

Every new signup defaults to `fisherman`. An admin must promote accounts to other roles via the Admin console.

---

## Project Structure

```
src/
├── routes/
│   ├── __root.tsx                  # App shell
│   ├── index.tsx                   # Redirects to /auth or role dashboard
│   ├── auth.tsx                    # Login / signup page
│   └── _authenticated/
│       ├── route.tsx               # Auth gate + role resolver
│       ├── admin.tsx               # Admin dashboard
│       ├── bmu.tsx                 # BMU console
│       ├── rescue.tsx              # Rescue operations center
│       └── fisherman.tsx           # Fisherman portal
│   └── api/public/ingest/
│       ├── sos.ts                  # Hardware SOS trigger endpoint
│       ├── location.ts             # Continuous GPS update endpoint
│       └── cancel.ts               # SOS cancel endpoint
├── lib/
│   ├── use-role.ts                 # Role types, ROLE_HOME, helpers
│   ├── route-guard.ts              # requireRole() for beforeLoad
│   ├── marine-types.ts             # Shared domain types
│   └── utils.ts                   # cn() tailwind helper
├── integrations/
│   ├── supabase/
│   │   ├── client.ts               # Browser Supabase client
│   │   ├── client.server.ts        # Server-side admin client (service role)
│   │   ├── auth-attacher.ts        # Attaches bearer token to serverFn calls
│   │   ├── auth-middleware.ts      # requireSupabaseAuth middleware
│   │   └── types.ts                # Generated DB types
│   └── lovable/
│       └── index.ts                # Lovable OAuth helper
├── assets/
│   └── sos-alarm.mp3.asset.json    # SOS alarm audio URL
├── server.ts                       # SSR server entry with error handling
├── start.ts                        # TanStack Start config + middleware
├── router.tsx                      # Router factory
├── routeTree.gen.ts                # Auto-generated — do not edit
└── styles.css                      # Global Tailwind styles

supabase/
└── migrations/                     # All DB migrations in order
```

---

## Environment Variables

Copy `.env` and fill in your values. Never commit the service role key.

```env
# Client-side (Vite injects these at build time)
VITE_SUPABASE_URL=https://yourproject.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

# Server-side (SSR + ingest endpoints)
SUPABASE_URL=https://yourproject.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

# Required for hardware ingest endpoints — NEVER expose to client
# Get from: Supabase Dashboard → Project Settings → API → service_role
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

---

## Getting Started

```bash
# Install dependencies
bun install

# Run dev server
bun run dev

# Build for production
bun run build

# Push DB migrations
supabase db push

# Generate fresh TypeScript types after schema changes
supabase gen types typescript --project-id <ref> > src/integrations/supabase/types.ts
```

### First-time admin setup

After the first user signs up, promote them to admin directly in Supabase SQL Editor:

```sql
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'
FROM   auth.users
WHERE  email = 'your-admin@example.com'
ON CONFLICT DO NOTHING;
```

Then log in and use the Admin console to assign roles to everyone else.

---

## Database Migrations

| File             | Description                                                                  |
| ---------------- | ---------------------------------------------------------------------------- |
| `20260625...`    | Initial schema: profiles, roles, devices, alerts, GPS logs, notifications    |
| `20260701...`    | Add `device_secret` column, remove public device read policy                 |
| `20260702...`    | Add `battery` and `emergency_level` columns to alerts + GPS logs             |
| `20260703...`    | Add `rescue_officer` + `fisherman` roles, sea trips, trip crew, trip history |
| `20260705...`    | Overdue trip auto-detection (pg_cron), realtime publication extensions       |
| `20260706000000` | Add `rescue_officer` enum value                                              |
| `20260706000001` | Migrate old roles, add fisherman-link constraint                             |

---

## Routing Conventions

TanStack Start uses **file-based routing**. Every `.tsx` in `src/routes/` is a route.

| File                            | URL                              |
| ------------------------------- | -------------------------------- |
| `index.tsx`                     | `/` → redirects based on session |
| `auth.tsx`                      | `/auth`                          |
| `_authenticated/admin.tsx`      | `/admin`                         |
| `_authenticated/bmu.tsx`        | `/bmu`                           |
| `_authenticated/rescue.tsx`     | `/rescue`                        |
| `_authenticated/fisherman.tsx`  | `/fisherman`                     |
| `api/public/ingest/sos.ts`      | `/api/public/ingest/sos`         |
| `api/public/ingest/location.ts` | `/api/public/ingest/location`    |
| `api/public/ingest/cancel.ts`   | `/api/public/ingest/cancel`      |

`routeTree.gen.ts` is auto-generated by TanStack Router. Do not edit it.

---

## Hardware Integration

See **[HARDWARE_INTEGRATION.md](./HARDWARE_INTEGRATION.md)** for the complete firmware integration guide including all endpoint payloads, authentication, and example ESP32 code.
