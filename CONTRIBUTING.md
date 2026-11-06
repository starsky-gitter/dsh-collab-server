# Contributing

Thanks for helping. This project has two halves:

```
hub/      zero-dependency Node HTTP server (records, search, brief)
plugin/   DeepSeek Harness bundle (host tools + settings-page UI)
```

## Development setup

```bash
git clone <repo>
cd dsh-collab-server
node hub/smoke.mjs          # server tests, no dependencies to install
node --check plugin/index.js && node --check plugin/client.js
```

Install the plugin into a **test profile** rather than your main one:

```bash
dsh plugin --profile desktop add ./plugin
```

The plugin's client half is plain JavaScript loaded by the DSH Web UI. After editing
`plugin/client.js`, refresh the page; the installed bundle is linked from this
directory, so no build step exists.

## What to work on

- **Server**: keep it zero-dependency and single-file friendly. New endpoints need a
  smoke assertion in `hub/smoke.mjs`.
- **Host plugin**: tools are registered through `ctx.tools.register`; keep the
  schema accurate and the result text small. The brief must stay under ~900 tokens.
- **UI**: use only `--dsw-alias-*` theme tokens. Never hardcode colors except artwork.
  Both light and dark mode must be readable. Prefer `color-mix()` on tokens for tints.

## Design rules

1. Records are atomic and append-only; corrections are new records or status changes.
2. Only `verified` records reach the model automatically.
3. Secrets never leave the machine; redaction runs before upload.
4. The hub is a relay and index, not a chat archive.

## Pull requests

- One concern per PR, with a short "why" in the description.
- Run `node hub/smoke.mjs` and the syntax checks above.
- If you change the record schema, note the migration in the PR and keep old records readable.

## Reporting security issues

Do not open a public issue for secrets, auth bypasses or data exposure. Email the
maintainers listed in the repository profile.
