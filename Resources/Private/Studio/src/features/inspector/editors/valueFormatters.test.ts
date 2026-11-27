/// <reference types="node" />
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Asset, NodeAddress } from '@/api/neos/schema'
import type { ValueFormatContext } from './registry'
import {
  createValueFormatters,
  plainFormattedValue,
  stripMarkup,
  type LabelledNode,
  type ValueFormatServices,
} from './valueFormatters.ts'

const edited: NodeAddress = {
  contentRepositoryId: 'default',
  workspaceName: 'user-admin',
  dimensionSpacePoint: '{"language":"de"}',
  nodeAggregateId: 'edited-node',
}

const nodes: Record<string, LabelledNode> = {
  home: { nodeAggregateId: 'home', label: 'Home' },
  about: { nodeAggregateId: 'about', label: 'About us' },
}

const assets: Record<string, Pick<Asset, 'label'>> = {
  'asset-1': { label: 'Brochure.pdf' },
  'image-1': { label: 'Team photo' },
}

function setup(overrides: Partial<ValueFormatServices> = {}) {
  const lookups = {
    nodes: [] as { subgraph: NodeAddress; ids: string[] }[],
    dataSources: [] as unknown[],
  }
  const services: ValueFormatServices = {
    option: (options, name) =>
      typeof options[name] === 'string' && options[name] !== ''
        ? (options[name] as string)
        : undefined,
    humanizeLabel: (label, key) =>
      label === 'Acme.Site:NodeTypes.Teaser:style.dark'
        ? 'Dunkel'
        : (label ?? key.charAt(0).toUpperCase() + key.slice(1)),
    fallbackSubgraph: () => ({
      ...edited,
      workspaceName: 'live',
      nodeAggregateId: 'site',
    }),
    resolveNodes: async (subgraph, ids) => {
      lookups.nodes.push({ subgraph, ids })
      return new Map(ids.map((id) => [id, nodes[id] ?? null]))
    },
    fetchAsset: async (id) => (assets[id] as Asset | undefined) ?? null,
    fetchDataSource: async (params) => {
      lookups.dataSources.push(params)
      return [
        { value: 'red', label: 'Red' },
        { value: 'blue', label: 'Blue' },
      ]
    },
    nodeTypeLabel: async (_contentRepositoryId, name) =>
      name === 'Neos.Demo:Document.Page' ? 'Page' : null,
    ...overrides,
  }
  return { formatters: createValueFormatters(services), lookups }
}

function context(
  options: Record<string, unknown> = {},
  extra: Partial<ValueFormatContext> = {},
): ValueFormatContext {
  return {
    subject: { name: 'field', type: 'string', label: 'Featured' },
    options,
    nodeAddress: edited,
    ...extra,
  }
}

void describe('plainFormattedValue', () => {
  void it('shows strings, numbers and booleans', () => {
    assert.deepEqual(plainFormattedValue('Hello'), { label: 'Hello' })
    assert.deepEqual(plainFormattedValue(42), { label: '42' })
    assert.deepEqual(plainFormattedValue(false), { label: 'false' })
  })

  void it('strips markup', () => {
    assert.deepEqual(plainFormattedValue('<p>Hello <b>you</b></p>'), {
      label: 'Hello you',
    })
  })

  void it('joins a list of scalars', () => {
    assert.deepEqual(plainFormattedValue(['a', 2, true]), {
      label: 'a, 2, true',
    })
  })

  void it('shows nothing for no value', () => {
    assert.equal(plainFormattedValue(null), null)
    assert.equal(plainFormattedValue(''), null)
    assert.equal(plainFormattedValue([]), null)
    assert.equal(plainFormattedValue({ id: 'x' }), null)
  })
})

void describe('text formatters', () => {
  const { formatters } = setup()

  void it('shows a text field as it is, on one line', () => {
    assert.deepEqual(formatters.text('Hello\n world', context()), {
      label: 'Hello world',
    })
    assert.equal(formatters.text('', context()), null)
  })

  void it('strips tags from markup and decodes entities', () => {
    assert.deepEqual(
      formatters.markup(
        '<p>Fish &amp; chips</p><p>&lt;today&gt;</p>',
        context(),
      ),
      { label: 'Fish & chips <today>' },
    )
    assert.equal(formatters.markup('<p></p>', context()), null)
    assert.equal(stripMarkup('a<br>b'), 'a b')
    assert.equal(stripMarkup('<p>&#99999999;</p>'), '&#99999999;')
  })
})

void describe('boolean formatter', () => {
  const { formatters } = setup()

  void it('shows the property label when true', () => {
    assert.deepEqual(formatters.boolean(true, context()), { label: 'Featured' })
  })

  void it('shows nothing when false', () => {
    assert.equal(formatters.boolean(false, context()), null)
    assert.equal(formatters.boolean(null, context()), null)
  })
})

void describe('date time formatter', () => {
  const { formatters } = setup()

  void it('formats with editorOptions.format', () => {
    assert.deepEqual(
      formatters.dateTime(
        '2026-03-05T14:30:00',
        context({ format: 'd.m.Y H:i' }),
      ),
      { label: '05.03.2026 14:30' },
    )
  })

  void it('defaults to the Neos format', () => {
    assert.deepEqual(formatters.dateTime('2026-03-05T14:30:00', context()), {
      label: '05-03-2026',
    })
  })

  void it('shows an invalid date as stored', () => {
    assert.deepEqual(formatters.dateTime('next week', context()), {
      label: 'next week',
    })
    assert.equal(formatters.dateTime('', context()), null)
  })
})

void describe('range formatter', () => {
  const { formatters } = setup()

  void it('shows the number with its unit', () => {
    assert.deepEqual(formatters.range(40, context({ unit: '%' })), {
      label: '40%',
    })
    assert.deepEqual(formatters.range(3, context()), { label: '3' })
    assert.equal(formatters.range(null, context()), null)
  })
})

void describe('select box formatter', () => {
  const values = {
    light: { label: 'Light' },
    dark: { label: 'Acme.Site:NodeTypes.Teaser:style.dark' },
    plain: null,
  }

  void it('shows the label of a static option, translated', () => {
    const { formatters } = setup()
    assert.deepEqual(formatters.select('light', context({ values })), {
      label: 'Light',
    })
    assert.deepEqual(formatters.select('dark', context({ values })), {
      label: 'Dunkel',
    })
  })

  void it('humanizes an option without a label', () => {
    const { formatters } = setup()
    assert.deepEqual(formatters.select('plain', context({ values })), {
      label: 'Plain',
    })
  })

  void it('shows an unknown key as it is', () => {
    const { formatters } = setup()
    assert.deepEqual(formatters.select('neon', context({ values })), {
      label: 'neon',
    })
  })

  void it('joins a multiple selection in stored order', () => {
    const { formatters } = setup()
    assert.deepEqual(
      formatters.select(['dark', 'light'], context({ values, multiple: true })),
      { label: 'Dunkel, Light' },
    )
    assert.equal(
      formatters.select([], context({ values, multiple: true })),
      null,
    )
  })

  void it('shows the labels of a data source, loaded for the edited node', async () => {
    const { formatters, lookups } = setup()
    const options = {
      dataSourceIdentifier: 'acme-colors',
      dataSourceAdditionalData: { palette: 'brand' },
    }
    assert.deepEqual(
      await formatters.select(['blue', 'red', 'green'], context(options)),
      { label: 'Blue, Red, green' },
    )
    assert.deepEqual(lookups.dataSources, [
      {
        identifier: 'acme-colors',
        node: edited,
        additionalData: { palette: 'brand' },
        disableCaching: false,
      },
    ])
  })

  void it('shows nothing for no value, without loading the data source', () => {
    const { formatters, lookups } = setup()
    assert.equal(
      formatters.select(null, context({ dataSourceIdentifier: 'acme-colors' })),
      null,
    )
    assert.equal(lookups.dataSources.length, 0)
  })
})

void describe('link formatter', () => {
  void it('shows the label of a linked node, with its anchor', async () => {
    const { formatters, lookups } = setup()
    assert.deepEqual(await formatters.link('node://about', context()), {
      label: 'About us',
    })
    assert.deepEqual(await formatters.link('node://about#team', context()), {
      label: 'About us #team',
    })
    assert.equal(lookups.nodes[0]?.subgraph, edited)
  })

  void it('marks a node that does not resolve as missing', async () => {
    const { formatters } = setup()
    assert.deepEqual(await formatters.link('node://removed', context()), {
      label: 'node://removed',
      missing: true,
    })
  })

  void it('looks nodes up in the fallback subgraph without an edited node', async () => {
    const { formatters, lookups } = setup()
    await formatters.link(
      'node://home',
      context({}, { nodeAddress: undefined }),
    )
    assert.equal(lookups.nodes[0]?.subgraph.workspaceName, 'live')
  })

  void it('shows the label of a linked asset, missing when gone', async () => {
    const { formatters } = setup()
    assert.deepEqual(await formatters.link('asset://asset-1', context()), {
      label: 'Brochure.pdf',
    })
    assert.deepEqual(await formatters.link('asset://gone', context()), {
      label: 'asset://gone',
      missing: true,
    })
  })

  void it('shows other links as stored', async () => {
    const { formatters } = setup()
    assert.deepEqual(await formatters.link('https://neos.io', context()), {
      label: 'https://neos.io',
    })
    assert.deepEqual(await formatters.link('mailto:hi@neos.io', context()), {
      label: 'mailto:hi@neos.io',
    })
    assert.equal(await formatters.link('', context()), null)
  })
})

void describe('reference formatter', () => {
  void it('shows the label of a reference', async () => {
    const { formatters } = setup()
    assert.deepEqual(await formatters.reference('home', context()), {
      label: 'Home',
    })
  })

  void it('joins the labels of references in one lookup, marking missing ones', async () => {
    const { formatters, lookups } = setup()
    assert.deepEqual(
      await formatters.reference(['about', 'removed', 'home'], context()),
      { label: 'About us, removed, Home', missing: true },
    )
    assert.deepEqual(lookups.nodes, [
      { subgraph: edited, ids: ['about', 'removed', 'home'] },
    ])
  })

  void it('takes nodes as well as ids', async () => {
    const { formatters } = setup()
    assert.deepEqual(
      await formatters.reference([{ nodeAggregateId: 'home' }], context()),
      { label: 'Home' },
    )
    assert.equal(await formatters.reference([], context()), null)
  })
})

void describe('node type formatter', () => {
  void it("shows the node type's label, or its name when unknown", async () => {
    const { formatters } = setup()
    assert.deepEqual(
      await formatters.nodeType('Neos.Demo:Document.Page', context()),
      { label: 'Page' },
    )
    assert.deepEqual(await formatters.nodeType('Acme:Gone', context()), {
      label: 'Acme:Gone',
    })
  })
})

void describe('asset formatter', () => {
  void it('shows the label of an asset', async () => {
    const { formatters } = setup()
    assert.deepEqual(await formatters.asset({ id: 'image-1' }, context()), {
      label: 'Team photo',
    })
  })

  void it('joins a collection, marking gone assets', async () => {
    const { formatters } = setup()
    assert.deepEqual(
      await formatters.asset([{ id: 'image-1' }, 'gone', 'asset-1'], context()),
      { label: 'Team photo, gone, Brochure.pdf', missing: true },
    )
    assert.equal(await formatters.asset(null, context()), null)
  })
})
