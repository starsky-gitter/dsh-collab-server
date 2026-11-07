/**
 * Smoke test for the elastic node: boots two nodes in temp dirs, writes on one,
 * syncs the other, and checks convergence, search, status LWW and auth.
 *
 *   node hub/smoke.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
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
let hostNode = null
let slaveNode = null
const dirHost = tempDir()
const dirSlave = tempDir()

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

  // shared files: manifest + content-addressed blob
  await fetch(A.url + '/api/files/demo/manifest', {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({ files: [{ path: 'Core/Src/main.c', hash: 'a'.repeat(64), size: 12, mtime: 1, by: 'tester' }] }),
  })
  const manifest = await (await fetch(A.url + '/api/files/demo/manifest', { headers: HEADERS })).json()
  assert(manifest.files.length === 1 && manifest.files[0].path === 'Core/Src/main.c', 'file manifest roundtrip')

  const payload = Buffer.from('hello team')
  const hash = createHash('sha256').update(payload).digest('hex')
  const upload = await fetch(A.url + '/api/files/demo/blob/' + hash, {
    method: 'PUT',
    headers: { 'x-team-token': TOKEN },
    body: payload,
  })
  assert(upload.status === 200, 'blob upload')
  const download = await fetch(A.url + '/api/files/demo/blob/' + hash, { headers: { 'x-team-token': TOKEN } })
  assert((await download.text()) === 'hello team', 'blob download matches')

  // identity: one token per member, author derived from the token
  const memberCreated = await (
    await fetch(A.url + '/api/team/members', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ name: '张三' }),
    })
  ).json()
  assert(memberCreated.token && memberCreated.member.id, 'admin creates a member with a token')
  const asMember = await (
    await fetch(A.url + '/api/records', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-team-token': memberCreated.token },
      body: JSON.stringify({ project: 'demo', kind: 'fact', title: '成员写入', body: '作者应由令牌推导，而不是客户端自称。' }),
    })
  ).json()
  assert(asMember.record.author === '张三', 'author is derived from the member token')
  const forbidden = await fetch(A.url + '/api/team/members', {
    headers: { 'x-team-token': memberCreated.token },
  })
  assert(forbidden.status === 403, 'a member cannot list the roster')

  const rotated = await (
    await fetch(A.url + '/api/team/members/' + memberCreated.member.id + '/token', {
      method: 'POST',
      headers: HEADERS,
    })
  ).json()
  assert(rotated.token && rotated.token !== memberCreated.token, 'a token can be rotated at any time')
  const oldToken = await fetch(A.url + '/api/records', { headers: { 'x-team-token': memberCreated.token } })
  assert(oldToken.status === 401, 'the old token stops working after rotation')
  const newTokenOk = await fetch(A.url + '/api/records', { headers: { 'x-team-token': rotated.token } })
  assert(newTokenOk.status === 200, 'the rotated token works')

  await fetch(A.url + '/api/team/members/' + memberCreated.member.id, { method: 'DELETE', headers: HEADERS })
  const afterDelete = await fetch(A.url + '/api/records', { headers: { 'x-team-token': rotated.token } })
  assert(afterDelete.status === 401, 'a deleted member cannot authenticate')

  // split credentials: local token authenticates the embedded node, the member
  // token authenticates against the host and survives the slave's own 401 trap
  hostNode = await startNode({
    dataDir: dirHost,
    port: 0,
    host: '127.0.0.1',
    token: 'local-host',
    adminToken: 'shared-secret',
    peerToken: 'shared-secret',
    syncMs: 60000,
  })
  const memberToken = await (
    await fetch(hostNode.url + '/api/team/members', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-team-token': 'shared-secret' },
      body: JSON.stringify({ name: 'bob' }),
    })
  ).json()
  slaveNode = await startNode({
    dataDir: dirSlave,
    port: 0,
    host: '127.0.0.1',
    token: 'local-slave',
    adminToken: memberToken.token,
    peerToken: memberToken.token,
    localName: 'bob',
    syncMs: 60000,
  })
  const slaveWrite = await fetch(slaveNode.url + '/api/records', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-team-token': 'local-slave' },
    body: JSON.stringify({ project: 'demo', kind: 'fact', title: '从机写入', body: '本机令牌只用于本地节点。' }),
  })
  assert(slaveWrite.status === 201, 'slave writes to its own node with the local token')
  slaveNode.setPeers([hostNode.url])
  await slaveNode.syncNow()
  const hostView = await (await fetch(hostNode.url + '/api/records?project=demo', { headers: { 'x-team-token': 'shared-secret' } })).json()
  assert(hostView.records.some((record) => record.title === '从机写入'), 'member token syncs the slave record to the host')
  assert(hostView.records.find((record) => record.title === '从机写入').author === 'bob', 'host derives the author from the member token')

  console.log('\nSMOKE OK')
} catch (error) {
  console.error('\nSMOKE FAILED:', error && error.message)
  process.exitCode = 1
} finally {
  if (A) await A.close()
  if (B) await B.close()
  if (hostNode) await hostNode.close()
  if (slaveNode) await slaveNode.close()
  fs.rmSync(dirA, { recursive: true, force: true })
  fs.rmSync(dirB, { recursive: true, force: true })
  fs.rmSync(dirHost, { recursive: true, force: true })
  fs.rmSync(dirSlave, { recursive: true, force: true })
}
