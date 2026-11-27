/// <reference types="node" />
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBatchLoader } from './batchLoader.ts'

interface Item {
  id: string
}

function loaderOver(known: (id: string) => boolean) {
  const calls: { group: string; ids: string[] }[] = []
  const load = createBatchLoader<Item>({
    load: async (group, ids) => {
      calls.push({ group, ids })
      return ids.filter(known).map((id) => ({ id }))
    },
    idOf: (item) => item.id,
    maxPerRequest: 100,
  })
  return { load, calls }
}

void describe('createBatchLoader', () => {
  void it('merges the loads of one tick into one request per group', async () => {
    const { load, calls } = loaderOver(() => true)
    const [a, b] = await Promise.all([load('live', 'a'), load('live', 'b')])
    assert.deepEqual(a, { id: 'a' })
    assert.deepEqual(b, { id: 'b' })
    assert.deepEqual(calls, [{ group: 'live', ids: ['a', 'b'] }])
  })

  void it('loads each group on its own', async () => {
    const { load, calls } = loaderOver(() => true)
    await Promise.all([load('live', 'a'), load('user-admin', 'a')])
    assert.deepEqual(
      calls.map((call) => call.group),
      ['live', 'user-admin'],
    )
  })

  void it('loads an id asked for twice once, answering both', async () => {
    const { load, calls } = loaderOver(() => true)
    const [first, second] = await Promise.all([
      load('live', 'a'),
      load('live', 'a'),
    ])
    assert.deepEqual(first, { id: 'a' })
    assert.deepEqual(second, { id: 'a' })
    assert.deepEqual(calls[0]?.ids, ['a'])
  })

  void it('resolves an id that does not come back to null, not an error', async () => {
    const { load } = loaderOver((id) => id !== 'gone')
    const [found, gone] = await Promise.all([
      load('live', 'a'),
      load('live', 'gone'),
    ])
    assert.deepEqual(found, { id: 'a' })
    assert.equal(gone, null)
  })

  void it('splits more than 100 ids into several requests', async () => {
    const { load, calls } = loaderOver(() => true)
    const ids = Array.from({ length: 250 }, (_, index) => `node-${index}`)
    const items = await Promise.all(ids.map((id) => load('live', id)))
    assert.deepEqual(
      calls.map((call) => call.ids.length),
      [100, 100, 50],
    )
    assert.deepEqual(
      items.map((item) => item?.id),
      ids,
    )
  })

  void it('makes a new request for loads of a later tick', async () => {
    const { load, calls } = loaderOver(() => true)
    await load('live', 'a')
    await load('live', 'b')
    assert.equal(calls.length, 2)
  })

  void it('rejects the loads of a failed request', async () => {
    const load = createBatchLoader<Item>({
      load: async () => {
        throw new Error('offline')
      },
      idOf: (item) => item.id,
      maxPerRequest: 100,
    })
    await assert.rejects(load('live', 'a'), /offline/)
  })
})
