# dsh-collab-server

Shared AI context for engineering teams running [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

When one engineer's AI works out a hardware quirk, a design decision, or a dead end, the rest of the team's AIs should be able to use it — **one record at a time**, not by reading a growing markdown file and not by replaying someone else's chat log.

```
member A's DSH ──┐
member B's DSH ──┼── peer sync (append-only events + digests, every 15s)
member C's DSH ──┘
```

Every DSH instance is a node with its own log. Writes are always local; nodes converge whenever two of them are reachable. No single writer, no lost updates.

## Why not just share files or transcripts?

- A markdown knowledge base forces every AI to read all of it; cost grows with the file.
- A transcript is 90% dead ends, tool noise and model-specific reasoning; it is also unverifiable and leaks secrets.
- Records are atomic, addressable and carry a **review status**, so the receiving AI can tell a verified hardware fact from an AI guess.

## What a record is

```json
{
  "id": "r_mw54ps8r",
  "project": "motor-f407",
  "kind": "fact",
  "title": "USART1 + DMA loses the first byte at 500k baud",
  "body": "Symptom, conditions, workaround, how it was verified.",
  "scope": { "board": "F407IG", "mcu": "STM32F407", "paths": ["drivers/usart/**"] },
  "status": "verified",
  "evidence": [{ "type": "serial", "label": "100k frames without loss" }],
  "author": "zhangsan",
  "tags": ["USART", "DMA"]
}
```

Status is trust: `draft` (AI proposal) → `verified` (human or hardware evidence) → `stale` (no longer applies). Only `verified` records enter the session brief.

## What the AI sees

- **At session start**: a brief of the newest verified records — id, title, one line, author, scope. Roughly 600–900 tokens, cached as a stable prompt section.
- **On demand**: `team_recall(query, kind, status)` returns matching records; `team_get(id)` returns the full body and evidence.
- **Writes**: `team_share` submits one record (200–600 characters, redacted before upload); `team_review` changes status.
- **Task close**: before declaring a task done, the model self-checks whether the turn produced a reusable conclusion and submits a draft if it did. The always-on prompt section carries this; `skills/team-context/SKILL.md` is the longer checklist for profiles that load filesystem skills.

There is no bulk read. Context cost is proportional to what the AI actually needs.

## Quick start

### 1. Install the DSH plugin

```bash
git clone https://github.com/starsky-gitter/dsh-collab-server.git
dsh plugin --profile desktop add ./dsh-collab-server/plugin
```

Without git, unpack a release zip and point `add` at its `plugin` directory.

Restart DSH. Each instance **embeds its own node**: it listens on `127.0.0.1:7420`, keeps an append-only event log under the DSH profile directory, and serves both the tools and the panel. There is no server to start and nothing to keep running.

### 2. Join peers (optional)

Point `peers` at the other machines:

```yaml
peers:
  - http://192.168.1.21:7420
  - http://192.168.1.22:7420
```

Each node then exchanges what it has with every peer every 15 seconds, in both directions. A machine that was offline simply catches up on its next successful round; a machine that is off never blocks anyone else. Leave `peers` empty for a single-machine setup.

### Host / member topology (no mesh needed)

One machine keeps the total database and accepts writes from the others:

```yaml
# host: keeps the full log, accepts inbound
expose: true
peers: []

# every member machine: dials the host, never needs inbound
primary: http://192.168.1.20:7420
```

If the host is offline, a member keeps writing to its local log; the panel shows
`待同步 N`. The sync loop retries every 15 seconds and delivers the backlog on the
first successful round — no manual retry, no lost writes. The same works in reverse:
a member that was offline catches up on the host's newer records in the same round.

### Zones: a workspace is a shared context

Right-click a session → **Join team zone**. The plugin binds that session's workspace
path to a project name (the folder name) in `zones.json`. Every session opened in that
folder then reads and writes that project: the brief, the recall tools and every shared
record follow the workspace instead of a per-session setting.

| Endpoint | Purpose |
|---|---|
| `GET /team-api/zones?sessionId=…` | current binding for one session |
| `POST /team-api/zones` `{sessionId}` or `{cwd, project}` | bind |
| `DELETE /team-api/zones` `{cwd}` | unbind |

The panel's **Zones** view lists bindings and unbinds them. Bindings are per machine
(they live in the local node data directory), so each member binds their own copy of
the workspace path — that is what makes the machine-local queue and the shared project
coexist.

### 3. Optional: standalone node

For an always-on box, a cross-subnet relay, or a team without DSH on that machine:

```bash
DSH_TEAM_TOKEN=change-me DSH_TEAM_PEERS=http://192.168.1.21:7420 node hub/server.js
```

### 4. Use it

- **Sidebar → Team context** (团队共享): one click from the left rail; the same page also appears under Settings as a fallback.
- Browse, search, review, create records manually — an icon in the sidebar shows up alongside Plugins and Schedules.
- Ask your AI to "search the team knowledge base" or simply let it call `team_recall` when it hits an unfamiliar symptom.

### Verify

```bash
node hub/smoke.mjs
```

Covers create, list, Chinese bigram search, status change, brief filtering and token rejection.

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness, record count |
| GET | `/api/records?project=&q=&kind=&status=&limit=&since=` | search / incremental sync |
| POST | `/api/records` | create |
| GET | `/api/records/:id` | read one |
| PATCH | `/api/records/:id` | status / content update, appends history |
| GET | `/api/brief?project=&limit=` | verified-only compact list |
| GET | `/api/members?project=` | author counts |
| POST | `/api/sync` | peer round: exchange digests and missing events |

All routes except `/api/health` require `x-team-token`. The browser panel never holds the token: the DSH plugin proxies `/team-api/*` server-side.

## Configuration

Hub environment:

| Variable | Default | Description |
|---|---|---|
| `DSH_TEAM_PORT` | `7420` | listen port |
| `DSH_TEAM_HOST` | `0.0.0.0` | bind address |
| `DSH_TEAM_TOKEN` | `dev-token` | shared secret — **change it** |
| `DSH_TEAM_DATA` | `hub/data` | storage directory |

Plugin row (`plugin/cordis.patch.yml`):

| Key | Default | Description |
|---|---|---|
| `hubUrl` | `http://127.0.0.1:7420` | hub address |
| `token` | `dev-token` | must match the hub |
| `project` | `default` | namespace for records |
| `member` | `me` | author name shown in the panel |
| `autoBrief` | `true` | inject the session brief |
| `briefLimit` | `8` | records in the brief |
| `embedded` | `true` | run the node inside DSH |
| `peerPort` | `7420` | local node port |
| `peers` | `[]` | other nodes, e.g. `http://192.168.1.21:7420` |
| `primary` | `''` | host node for a member machine; buffers locally while unreachable |
| `expose` | `false` | bind `0.0.0.0` (the host sets this) |
| `dataDir` | profile dir | event log location |

## Security

- The hub stores **records only**, never raw conversations.
- Records are redacted before upload (private keys, API keys, `password=` assignments, common token formats).
- Shared records are treated as **data**, not instructions; only `verified` records are auto-injected.
- Plain HTTP by design for LAN use. For anything beyond a trusted network, put it behind TLS (reverse proxy) or a VPN.
- One token = one team. Per-user accounts and per-project scoping are roadmap items.

## Deployment modes

| Mode | Status | Notes |
|---|---|---|
| Local | ✅ default | embedded node, `127.0.0.1`, no peers |
| LAN mesh | ✅ | nodes sync directly; needs reachable ports and stable addresses |
| Relay | ✅ | one always-on node when direct reachability fails |
| Hosted / community | 🧭 planned | accounts, per-team isolation, Postgres, quotas — see [docs/ROADMAP.md](docs/ROADMAP.md) |

## Roadmap

- Auto-draft records at `turn-stopping` (review queue instead of relying on the model to remember to share).
- Offline queue on the client, retry when the hub returns.
- First-class sidebar page instead of a settings page.
- Supersede chains, environment fingerprint invalidation, bench leases for embedded labs.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The design rationale is in [docs/DESIGN.md](docs/DESIGN.md) (Chinese).

## License

MIT. See [LICENSE](LICENSE).
