/// <reference types="node" />
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { glyphOf } from './glyph.ts'

void describe('glyphOf', () => {
  void it('reads the character of a computed content value', () => {
    assert.equal(glyphOf('""'), '')
    assert.equal(glyphOf('"" / ""'), '')
  })

  void it('resolves CSS escapes', () => {
    assert.equal(glyphOf('"\\f017"'), '')
    assert.equal(glyphOf("'\\f017 '"), '')
    assert.equal(glyphOf('"\\"x"'), '"x')
  })

  void it('finds no glyph without a string', () => {
    assert.equal(glyphOf('none'), null)
    assert.equal(glyphOf('normal'), null)
    assert.equal(glyphOf('""'), null)
  })
})
