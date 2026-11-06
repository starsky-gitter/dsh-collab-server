/**
 * Smoke test for the elastic node: boots two nodes in temp dirs, writes on one,
 * syncs the other, and checks convergence, search, status LWW and auth.
 *
 *   node hub/smoke.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startNode } from '../plugin/core.js'

const TOKEN = 'smoke-token'
const HEADERS = { 'content-type': 'application/json', 'x-team-token': TOKEN, 'x-team-member': 'tester' }

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-team-'))
}

function assert(condition, message) {
  if (!condition) throw new Error('assertion failed: ' + message)
  console.log('  ok  ' + message)
}

const dirA = tempDir()
const dirB = tempDir()
let A = null
let B = null

try {
  A = await startNode({ dataDir: dirA, port: 0, host: '127.0.0.1', token: TOKEN, syncMs: 60000 })
  B = await startNode({ dataDir: dirB, port: 0, host: '127.0.0.1', token: TOKEN, syncMs: 60000 })
  assert(A.nodeId !== B.nodeId, 'two nodes have distinct identities')

  const healthA = await (await fetch(A.url + '/api/health')).json()
  assert(healthA.ok && healthA.records === 0, 'node A starts empty')

  const created = await (
    await fetch(A.url + '/api/records', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        project: 'demo',
        kind: 'fact',
        title: 'USART1 在 500k 下 DMA 会丢首字节',
        body: '现象：首帧首字节丢失。条件：USART1 + DMA 循环模式，波特率 500k。规避：发送前先写 TC 位。',
        scope: { board: 'F407IG', mcu: 'STM32F407', paths: ['drivers/usart/**'] },
        tags: ['USART', 'DMA'],
        status: 'verified',
        evidence: [{ type: 'serial', label: '连续 10 万帧无丢帧' }],
      }),
    })
  ).json()
  assert(created.record && created.record.id, 'create returns a record id')
  assert(created.record.status === 'verified', 'create-as-verified applies the status event')

  // node B has never seen A's data
  const beforeSync = await (await fetch(B.url + '/api/records?project=demo', { headers: HEADERS })).json()
  assert(beforeSync.records.length === 0, 'node B is empty before sync')

  B.setPeers([A.url])
  const first = await B.syncNow()
  assert(first.ok === 1 && first.failed === 0, 'node B reaches node A')

  const afterSync = await (await fetch(B.url + '/api/records?project=demo', { headers: HEADERS })).json()
  assert(afterSync.records.length === 1, 'record replicated to node B')
  assert(afterSync.records[0].status === 'verified', 'status replicated with the record')

  // status change on B must flow back to A (HLC last-writer-wins)
  await fetch(B.url + '/api/records/' + created.record.id, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ status: 'stale', note: '换了另一批芯片' }),
  })
  A.setPeers([B.url])
  await A.syncNow()
  const onA = await (await fetch(A.url + '/api/records/' + created.record.id, { headers: HEADERS })).json()
  assert(onA.record.status === 'stale', 'status change replicated back to node A')

  const searched = await (await fetch(A.url + '/api/records?q=' + encodeURIComponent('丢字节'), { headers: HEADERS })).json()
  assert(searched.records.length === 1, 'Chinese bigram search hits the record')

  const brief = await (await fetch(A.url + '/api/brief?project=demo', { headers: HEADERS })).json()
  assert(brief.records.length === 0, 'brief lists verified only, stale is excluded')

  const unauthorized = await fetch(A.url + '/api/records', { headers: { 'x-team-token': 'wrong' } })
  assert(unauthorized.status === 401, 'wrong token is rejected')

  // offline behaviour: a node with only a dead peer still accepts local writes
  B.setPeers(['http://127.0.0.1:1'])
  const offlineSync = await B.syncNow()
  assert(offlineSync.failed === 1, 'dead peer is reported, not thrown')
  const localWrite = await fetch(B.url + '/api/records', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ project: 'demo', kind: 'failure', title: '离线写入', body: '节点没有 peer 时仍然可写。' }),
  })
  assert(localWrite.status === 201, 'offline node still accepts local writes')

  // the host comes back: the buffered write is delivered on the next round
  B.setPeers([A.url])
  const buffered = B.peerState().reduce((sum, state) => sum + state.pending, 0)
  assert(buffered > 0, 'offline writes are counted as pending')
  const resumed = await B.syncNow()
  assert(resumed.ok === 1 && resumed.failed === 0, 'slave reconnects to the host')
  const hostRecords = await (await fetch(A.url + '/api/records?project=demo', { headers: HEADERS })).json()
  assert(hostRecords.records.length === 2, 'buffered write reached the host on reconnect')
  const drained = B.peerState().reduce((sum, state) => sum + state.pending, 0)
  assert(drained === 0, 'pending drains after a successful round')

  console.log('\nSMOKE OK')
} catch (error) {
  console.error('\nSMOKE FAILED:', error && error.message)
  process.exitCode = 1
} finally {
  if (A) await A.close()
  if (B) await B.close()
  fs.rmSync(dirA, { recursive: true, force: true })
  fs.rmSync(dirB, { recursive: true, force: true })
}
