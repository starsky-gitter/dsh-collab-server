#!/usr/bin/env node
/**
 * Standalone team node (optional).
 *
 *   node hub/server.js
 *   DSH_TEAM_PORT=7420 DSH_TEAM_TOKEN=team-xxx \
 *   DSH_TEAM_PEERS=http://192.168.1.21:7420 node hub/server.js
 *
 * Every DSH instance embeds the same node through plugin/core.js; this entry point
 * is for an always-on machine, a cross-subnet relay, or a team that has no DSH
 * running on the box.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startNode, DEFAULT_PEER_PORT } from '../plugin/core.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.DSH_TEAM_DATA || path.join(HERE, 'data')
const port = Number(process.env.DSH_TEAM_PORT || DEFAULT_PEER_PORT)
const host = process.env.DSH_TEAM_HOST || '0.0.0.0'
const token = process.env.DSH_TEAM_TOKEN ?? 'dev-token'
const peers = (process.env.DSH_TEAM_PEERS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const node = await startNode({
  dataDir,
  port,
  host,
  token,
  peers,
  log: (line) => console.log('[team-hub] ' + line),
})

console.log(`[team-hub] listening on http://${host}:${node.port} — node ${node.nodeId}`)
console.log(`[team-hub] data: ${dataDir}`)
if (peers.length) console.log(`[team-hub] peers: ${peers.join(', ')}`)
else console.log('[team-hub] no peers configured; records stay local to this node')

const shutdown = async () => {
  await node.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
