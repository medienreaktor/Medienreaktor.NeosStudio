/// <reference types="node" />
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseExternalHref } from './linkValue.ts'

function accepted(raw: string): string {
  const result = parseExternalHref(raw)
  assert.ok(result.ok, `expected "${raw}" to be accepted`)
  return result.href
}

function refusedAs(raw: string): string {
  const result = parseExternalHref(raw)
  assert.ok(!result.ok, `expected "${raw}" to be refused`)
  return result.error.kind
}

void describe('parseExternalHref', () => {
  void it('adds https:// to an address without scheme', () => {
    assert.equal(accepted('example.com'), 'https://example.com')
    assert.equal(
      accepted('  example.com/path?q=1  '),
      'https://example.com/path?q=1',
    )
  })

  void it('keeps addresses with a scheme as typed', () => {
    assert.equal(accepted('https://example.com'), 'https://example.com')
    assert.equal(accepted('http://example.com'), 'http://example.com')
    assert.equal(
      accepted('mailto:hello@example.com'),
      'mailto:hello@example.com',
    )
    assert.equal(accepted('tel:+49301234567'), 'tel:+49301234567')
    assert.equal(accepted('node://0a1b2c3d#intro'), 'node://0a1b2c3d#intro')
  })

  void it('keeps relative links as typed', () => {
    assert.equal(accepted('/contact'), '/contact')
    assert.equal(accepted('#intro'), '#intro')
    assert.equal(accepted('?page=2'), '?page=2')
    assert.equal(accepted('./file.pdf'), './file.pdf')
  })

  void it('accepts credentials and URLs further down the query', () => {
    assert.equal(
      accepted('https://user:secret@example.com'),
      'https://user:secret@example.com',
    )
    assert.equal(
      accepted('https://example.com/redirect?to=https://example.org'),
      'https://example.com/redirect?to=https://example.org',
    )
  })

  void it('reports empty input without calling it a mistake', () => {
    assert.equal(refusedAs(''), 'empty')
    assert.equal(refusedAs('   '), 'empty')
  })

  void it('refuses whitespace inside the address', () => {
    assert.equal(refusedAs('https://exa mple.com'), 'whitespace')
    assert.equal(refusedAs('example.com/a b'), 'whitespace')
    assert.equal(
      refusedAs('mailto:a@example.com?subject=Hello World'),
      'whitespace',
    )
  })

  void it('refuses a second scheme right behind the first', () => {
    assert.equal(refusedAs('https:// https://example.com'), 'second_scheme')
    assert.equal(refusedAs('https://https://example.com'), 'second_scheme')
    assert.equal(refusedAs('https://node://0a1b2c3d'), 'second_scheme')
    assert.equal(refusedAs('https://asset://0a1b2c3d'), 'second_scheme')
    assert.equal(refusedAs('https://mailto:hello@example.com'), 'second_scheme')
    assert.equal(refusedAs('example.com https://example.org'), 'second_scheme')
  })

  void it('refuses schemes that are not allowed', () => {
    assert.equal(refusedAs('javascript:alert(1)'), 'scheme_not_allowed')
    assert.equal(refusedAs('data:text/html,hi'), 'scheme_not_allowed')
  })

  void it('refuses what the URL parser cannot read', () => {
    assert.equal(refusedAs('https://'), 'unparsable')
    assert.equal(refusedAs('https://[::1'), 'unparsable')
    assert.equal(refusedAs('https://example.com:99999'), 'unparsable')
  })
})
