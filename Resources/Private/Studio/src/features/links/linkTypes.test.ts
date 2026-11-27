/// <reference types="node" />
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nodeTypesFilter } from '../inspector/editors/editorOptions.ts'
import { assetLinksEnabled, enabledLinkTypes } from './linkTypes.ts'

const types = [
  { id: 'document' },
  { id: 'asset', enabled: assetLinksEnabled },
  { id: 'external' },
  {
    id: 'Acme.Shop/LinkTypes/Product',
    enabled: (options: Record<string, unknown>) => options.products === true,
  },
]

const ids = (options: Record<string, unknown>) =>
  enabledLinkTypes(types, options).map((type) => type.id)

void describe('enabledLinkTypes', () => {
  void it('offers the asset tab by default', () => {
    assert.deepEqual(ids({}), ['document', 'asset', 'external'])
  })

  void it('hides the asset tab for assets: false', () => {
    assert.deepEqual(ids({ assets: false }), ['document', 'external'])
  })

  void it('keeps the asset tab for any other assets value', () => {
    assert.deepEqual(ids({ assets: true }), ['document', 'asset', 'external'])
  })

  void it('asks a plugin type with enabled', () => {
    assert.deepEqual(ids({ products: true, assets: false }), [
      'document',
      'external',
      'Acme.Shop/LinkTypes/Product',
    ])
  })
})

void describe('nodeTypesFilter', () => {
  void it('defaults to documents', () => {
    assert.equal(nodeTypesFilter({}), 'Neos.Neos:Document')
  })

  void it('takes a string as it is', () => {
    assert.equal(
      nodeTypesFilter({ nodeTypes: 'Neos.Demo:Document.Page' }),
      'Neos.Demo:Document.Page',
    )
  })

  void it('takes a comma-separated string, trimmed', () => {
    assert.equal(
      nodeTypesFilter({
        nodeTypes: 'Neos.Neos:Document, !Neos.Demo:Document.Chapter',
      }),
      'Neos.Neos:Document,!Neos.Demo:Document.Chapter',
    )
  })

  void it('joins a list', () => {
    assert.equal(
      nodeTypesFilter({
        nodeTypes: ['Neos.Demo:Document.Page', 'Neos.Demo:Document.Blog'],
      }),
      'Neos.Demo:Document.Page,Neos.Demo:Document.Blog',
    )
  })

  void it('falls back for an empty string or list, or entries of other types', () => {
    assert.equal(nodeTypesFilter({ nodeTypes: '' }), 'Neos.Neos:Document')
    assert.equal(nodeTypesFilter({ nodeTypes: [] }), 'Neos.Neos:Document')
    assert.equal(
      nodeTypesFilter({ nodeTypes: [1, null] }),
      'Neos.Neos:Document',
    )
  })

  void it('puts the fallback in front of a filter that only excludes', () => {
    assert.equal(
      nodeTypesFilter({ nodeTypes: ['!Acme:Folder'] }),
      'Neos.Neos:Document,!Acme:Folder',
    )
  })

  void it('takes another fallback', () => {
    assert.equal(nodeTypesFilter({}, 'Neos.Neos:Content'), 'Neos.Neos:Content')
  })
})
