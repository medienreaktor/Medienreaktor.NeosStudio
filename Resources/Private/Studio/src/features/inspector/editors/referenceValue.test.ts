/// <reference types="node" />
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  committedReferenceValue,
  parseReferenceIds,
  referenceEditorMode,
  referenceTargetState,
} from './referenceValue.ts'

void describe('referenceEditorMode', () => {
  void it('keeps Neos 9 references in graph mode', () => {
    assert.equal(referenceEditorMode('reference'), 'graph')
    assert.equal(referenceEditorMode('references'), 'graph')
  })

  void it('edits every other type as a value', () => {
    for (const type of ['string', 'array', 'array<string>', 'Acme:Field', '']) {
      assert.equal(referenceEditorMode(type), 'value', type)
    }
  })
})

void describe('parseReferenceIds', () => {
  void it('reads a string id', () => {
    assert.deepEqual(parseReferenceIds('a1b2'), ['a1b2'])
  })

  void it('reads a list of ids in order, each once', () => {
    assert.deepEqual(parseReferenceIds(['b', 'a', 'b']), ['b', 'a'])
  })

  void it('reads nothing from empty values and junk', () => {
    for (const value of [undefined, null, '', [], 42, true, {}, { id: 'a' }]) {
      assert.deepEqual(parseReferenceIds(value), [], JSON.stringify(value))
    }
    assert.deepEqual(parseReferenceIds(['a', 3, null, '', { id: 'b' }]), ['a'])
  })
})

void describe('committedReferenceValue', () => {
  void it('commits one id, or null when cleared, for the single editor', () => {
    assert.equal(committedReferenceValue(['a'], false), 'a')
    assert.equal(committedReferenceValue([], false), null)
  })

  void it('commits a list, empty when cleared, for the multi editor', () => {
    const ids = ['a', 'b']
    const committed = committedReferenceValue(ids, true)
    assert.deepEqual(committed, ['a', 'b'])
    assert.notEqual(committed, ids)
    assert.deepEqual(committedReferenceValue([], true), [])
  })

  void it('keeps missing ids through an unrelated edit', () => {
    // A removed target ('gone') stays when another one is removed.
    const stored = parseReferenceIds(['gone', 'home', 'about'])
    assert.deepEqual(
      committedReferenceValue(
        stored.filter((id) => id !== 'about'),
        true,
      ),
      ['gone', 'home'],
    )
  })
})

void describe('referenceTargetState', () => {
  void it('tells loading, missing, hidden and shown targets apart', () => {
    assert.equal(referenceTargetState(undefined), 'loading')
    assert.equal(referenceTargetState(null), 'missing')
    assert.equal(
      referenceTargetState({ isHidden: false, isHiddenByAncestor: false }),
      'resolved',
    )
    assert.equal(
      referenceTargetState({ isHidden: true, isHiddenByAncestor: false }),
      'hidden',
    )
    assert.equal(
      referenceTargetState({ isHidden: false, isHiddenByAncestor: true }),
      'hidden',
    )
  })
})
