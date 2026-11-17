/// <reference types="node" />
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { documentAnchors } from './documentAnchors.ts'

const properties = { property: 'sectionId', labelProperty: 'anchorName' }

function node(nodeAggregateId: string, label: string, props: object) {
  return { nodeAggregateId, label, properties: { ...props } }
}

void describe('documentAnchors', () => {
  void it('labels an anchor by the label property, else by the node label', () => {
    assert.deepEqual(
      documentAnchors(
        [
          node('a', 'Section', {
            sectionId: 'intro',
            anchorName: 'Einleitung',
          }),
          node('b', 'Text', { sectionId: 'details', anchorName: '' }),
        ],
        properties,
      ),
      [
        { anchor: 'intro', label: 'Einleitung', nodeAggregateId: 'a' },
        { anchor: 'details', label: 'Text', nodeAggregateId: 'b' },
      ],
    )
  })

  void it('skips nodes without a filled anchor', () => {
    assert.deepEqual(
      documentAnchors(
        [
          node('a', 'Section', {}),
          node('b', 'Section', { sectionId: '  ' }),
          node('c', 'Section', { sectionId: 42 }),
        ],
        properties,
      ),
      [],
    )
  })

  void it('reads the configured properties', () => {
    assert.deepEqual(
      documentAnchors([node('a', 'Section', { anchor: 'top', title: 'Top' })], {
        property: 'anchor',
        labelProperty: 'title',
      }),
      [{ anchor: 'top', label: 'Top', nodeAggregateId: 'a' }],
    )
  })
})
