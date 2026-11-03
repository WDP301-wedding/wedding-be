# Realtime authentication admission and auth pool starvation

Production login and refresh returned HTTP 500 (`P2028`) while readiness and
public catalog reads succeeded. The application pool diagnostic recorded over
33,000 pending acquisitions; PostgreSQL had 8–11 connections out of 100, no
blocking transactions, and no failed migrations. These observations establish
application-side starvation, not database capacity exhaustion.

A real Socket.IO/Engine.IO reproduction sends 60 namespace CONNECT packets over
one WebSocket while the first session lookup is unresolved. Before the fix, it
starts 60 database lookups despite Engine.IO reporting only one connection.
Account/IP connection reservations and packet rate limits run after authentication
and therefore do not protect this phase. This is a demonstrated producer of an
unbounded queue; production recovery still requires verification after deployment.

The server now admits only one pending authentication per Engine.IO transport
and at most 32 per server process, before any database lookup. Duplicate or
over-capacity attempts close their transport. A closed transport cannot continue
to the second credential lookup, account reservation, or room admission. Pending
capacity remains occupied until the database operation settles, so disconnecting
and reconnecting cannot evade the cap. Completion and failures release capacity.

Current credential, session, account, role, grant, expiry, Redis connection-limit
and message-rate checks remain in the authentication path. A failed handshake
releases any account/IP reservation it acquired. Rejection logs contain only a
static reason and pending count; they contain no token, SQL, identity, or IP.

The regression suite exercises the real WebSocket protocol, the global bound and
recovery, disconnect during authentication, and successful authentication. CI runs
it explicitly. No schema, migration, REST contract, payment or historical data
changes are needed. Keep the existing 1 CPU / 2 GB service plan for rollout.

Deploy only after exact-head CI passes. Verify actual login, cookie refresh and
logout in addition to readiness/catalog reads, then observe error logs and process
uptime. If rollback is required, redeploy the previous application commit without
changing the database or increasing network access. Temporary database network
access and diagnostic flags used during investigation have already been restored.
