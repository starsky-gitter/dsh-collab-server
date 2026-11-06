# Roadmap

## v0.1 — current

- Elastic node embedded in every DSH instance: append-only event log, per-origin
  digests, HLC last-writer-wins status, peer sync every 15s.
- Host / member topology (`expose` on the host, `primary` on members) and an
  optional standalone node for an always-on box.
- Local writes never block: an unreachable host leaves them buffered, the panel
  shows `待同步 N`, and the next successful round drains the backlog.
- DSH plugin: `team_recall` / `team_get` / `team_share` / `team_review`, session brief,
  redaction, `/team-api` proxy.
- Sidebar page: list, search, filters, detail, review, manual create.

## v0.2 — less manual work

- **Auto-draft at `agent/turn-stopping`**: extract a draft record from the turn's tool
  results and conclusions, land it in the review queue. Never auto-publish.
- **Review badge**: unread drafts count on the sidebar entry.
- **Zone binding**: map a workspace or a session to a project, so opening that
  workspace is enough to join its shared context.
- **Peer discovery**: mDNS/manual roster instead of static IPs.

## v0.3 — embedded specifics

- **Supersede chains**: a new record can replace an old one; recall follows the chain.
- **Environment fingerprint**: records carry toolchain / SDK / board revision; a reader
  with a different fingerprint sees "possibly stale" instead of silent trust.
- **Bench leases**: reserve a board for a time window, record the firmware digest and
  serial port, attach serial/logic captures as evidence.
- **Artifact refs**: link records to firmware images or logs by content hash.

## v1.0 — hosted / community mode

The hub is already a plain HTTP service with a single shared token. Hosting it for
multiple teams needs:

- **Tenancy**: `team` on every record; token → team mapping; per-project scoping.
- **Accounts**: OAuth/OIDC login for members; personal tokens; roles
  (`member` / `reviewer` / `admin`).
- **Storage**: SQLite → Postgres; records + evidence blobs in S3-compatible storage.
- **Abuse control**: rate limits, quotas per team, request size caps, audit log.
- **Transport**: TLS termination, CORS allowlist, signed webhooks.
- **Operations**: `/metrics`, structured logs, backup/restore, schema migrations.
- **Federation (optional)**: a team hub can mirror chosen projects to a community hub
  without exporting raw evidence.

Design constraint: the plugin must keep working against a local `node hub/server.js`
with no account system, so self-hosting never becomes a second-class path.
