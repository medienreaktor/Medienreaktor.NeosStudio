/// <reference types="node" />
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { Window } from 'happy-dom'

import { toClassicTables as convertInPlace } from './classicTables.ts'

// node has no DOM: happy-dom's window parses and serializes the markup the
// way the guest's <template> does in the browser. One local window for the
// file, no globals registered - toClassicTables only reaches the document
// through the nodes it is given (ownerDocument).
const window = new Window()
after(() => window.happyDOM.close())

function toClassicTables(html: string): string {
  const template = window.document.createElement('template')
  template.innerHTML = html
  // happy-dom's node types are structurally close to lib.dom's but not
  // assignable to them; the cast is the seam between the two.
  convertInPlace(template.content as unknown as DocumentFragment)
  return template.innerHTML
}

const COLGROUP_2 =
  '<colgroup><col style="min-width: 25px"><col style="min-width: 25px"></colgroup>'

void describe('toClassicTables', () => {
  void it('leaves HTML without tables untouched', () => {
    const html =
      '<p>Text with <a href="https://example.com?a=1&amp;b=2">a link</a></p><ul><li>item</li></ul>'
    assert.equal(toClassicTables(html), html)
  })

  void it('moves the heading row into a thead and wraps the table in a figure', () => {
    assert.equal(
      toClassicTables(
        `<table style="min-width: 50px">${COLGROUP_2}<tbody>` +
          '<tr><th>Name</th><th>Preis</th></tr>' +
          '<tr><td>A</td><td>1 €</td></tr>' +
          '</tbody></table>',
      ),
      '<figure class="table"><table>' +
        '<thead><tr><th>Name</th><th>Preis</th></tr></thead>' +
        '<tbody><tr><td>A</td><td>1 €</td></tr></tbody>' +
        '</table></figure>',
    )
  })

  void it('keeps a table without heading row in tbody only', () => {
    assert.equal(
      toClassicTables(
        `<table style="min-width: 50px">${COLGROUP_2}<tbody>` +
          '<tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr>' +
          '</tbody></table>',
      ),
      '<figure class="table"><table><tbody>' +
        '<tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr>' +
        '</tbody></table></figure>',
    )
  })

  void it('leaves a header column in the body', () => {
    assert.equal(
      toClassicTables(
        `<table style="min-width: 50px">${COLGROUP_2}<tbody>` +
          '<tr><th>Mo</th><td>9-17</td></tr><tr><th>Di</th><td>9-12</td></tr>' +
          '</tbody></table>',
      ),
      '<figure class="table"><table><tbody>' +
        '<tr><th>Mo</th><td>9-17</td></tr><tr><th>Di</th><td>9-12</td></tr>' +
        '</tbody></table></figure>',
    )
  })

  void it('takes only the leading all-header rows when both header row and column are set', () => {
    assert.equal(
      toClassicTables(
        `<table style="min-width: 50px">${COLGROUP_2}<tbody>` +
          '<tr><th></th><th>Preis</th></tr>' +
          '<tr><th>A</th><td>1</td></tr>' +
          '<tr><th>B</th><th>2</th></tr>' +
          '</tbody></table>',
      ),
      '<figure class="table"><table>' +
        '<thead><tr><th></th><th>Preis</th></tr></thead>' +
        '<tbody><tr><th>A</th><td>1</td></tr><tr><th>B</th><th>2</th></tr></tbody>' +
        '</table></figure>',
    )
  })

  void it('moves several leading heading rows', () => {
    assert.equal(
      toClassicTables(
        '<table><tbody>' +
          '<tr><th colspan="2">Gruppe</th></tr><tr><th>a</th><th>b</th></tr>' +
          '<tr><td>1</td><td>2</td></tr>' +
          '</tbody></table>',
      ),
      '<figure class="table"><table>' +
        '<thead><tr><th colspan="2">Gruppe</th></tr><tr><th>a</th><th>b</th></tr></thead>' +
        '<tbody><tr><td>1</td><td>2</td></tr></tbody>' +
        '</table></figure>',
    )
  })

  void it('omits tbody when every row is a heading row', () => {
    assert.equal(
      toClassicTables(
        `<table style="min-width: 50px">${COLGROUP_2}<tbody>` +
          '<tr><th>a</th><th>b</th></tr></tbody></table>',
      ),
      '<figure class="table"><table><thead><tr><th>a</th><th>b</th></tr></thead></table></figure>',
    )
  })

  void it('drops resized widths from table, colgroup and cells', () => {
    assert.equal(
      toClassicTables(
        '<table style="width: 340px" width="340">' +
          '<colgroup><col style="width: 200px"><col style="width: 140px"></colgroup>' +
          '<tbody><tr><th colwidth="200">a</th><th colwidth="140">b</th></tr>' +
          '<tr><td colwidth="200">1</td><td colwidth="140" style="text-align: right">2</td></tr>' +
          '</tbody></table>',
      ),
      '<figure class="table"><table>' +
        '<thead><tr><th>a</th><th>b</th></tr></thead>' +
        '<tbody><tr><td>1</td><td style="text-align: right">2</td></tr></tbody>' +
        '</table></figure>',
    )
  })

  void it('keeps other table attributes, spans and cell contents', () => {
    assert.equal(
      toClassicTables(
        '<table class="striped" style="min-width: 50px"><tbody>' +
          '<tr><td rowspan="2"><p>one</p><p>two</p></td><td><strong>b</strong> &amp; <a href="/x?y=&quot;z&quot;">c</a><br>d</td></tr>' +
          '<tr><td><ul><li>x</li></ul></td></tr>' +
          '</tbody></table>',
      ),
      '<figure class="table"><table class="striped"><tbody>' +
        '<tr><td rowspan="2"><p>one</p><p>two</p></td><td><strong>b</strong> &amp; <a href="/x?y=&quot;z&quot;">c</a><br>d</td></tr>' +
        '<tr><td><ul><li>x</li></ul></td></tr>' +
        '</tbody></table></figure>',
    )
  })

  void it('converts every table and leaves the content around them alone', () => {
    const table = (cell: string) =>
      `<table style="min-width: 25px"><colgroup><col style="min-width: 25px"></colgroup><tbody><tr><td>${cell}</td></tr></tbody></table>`
    const classic = (cell: string) =>
      `<figure class="table"><table><tbody><tr><td>${cell}</td></tr></tbody></table></figure>`
    assert.equal(
      toClassicTables(
        `<p>before</p>${table('1')}<h2>between</h2>${table('2')}<p></p>`,
      ),
      `<p>before</p>${classic('1')}<h2>between</h2>${classic('2')}<p></p>`,
    )
  })

  void it('converts a table nested in a cell', () => {
    assert.equal(
      toClassicTables(
        '<table style="min-width: 25px"><colgroup><col style="min-width: 25px"></colgroup><tbody><tr><td>' +
          '<table style="min-width: 25px"><colgroup><col style="min-width: 25px"></colgroup><tbody><tr><th>in</th></tr><tr><td>1</td></tr></tbody></table>' +
          '</td></tr></tbody></table>',
      ),
      '<figure class="table"><table><tbody><tr><td>' +
        '<figure class="table"><table><thead><tr><th>in</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></figure>' +
        '</td></tr></tbody></table></figure>',
    )
  })

  void it('does not wrap a table that already sits in figure.table', () => {
    const classic =
      '<figure class="table"><table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></figure>'
    assert.equal(toClassicTables(classic), classic)
  })

  void it('round-trips a stored CKEditor table through TipTap unchanged', () => {
    // A CKEditor table as Neos stores it, and what TipTap's getHTML() makes
    // of it after loading (ProseMirror parses <figure> and <thead> as their
    // contents; serializedHtml has already unwrapped the cell paragraphs).
    const stored =
      '<figure class="table"><table>' +
      '<thead><tr><th>Name</th><th colspan="2">Preis</th></tr></thead>' +
      '<tbody><tr><th>A</th><td>1</td><td style="text-align: right">2</td></tr></tbody>' +
      '</table></figure>'
    const fromTipTap =
      '<table style="min-width: 75px"><colgroup><col style="min-width: 25px"><col style="min-width: 25px"><col style="min-width: 25px"></colgroup><tbody>' +
      '<tr><th>Name</th><th colspan="2">Preis</th></tr>' +
      '<tr><th>A</th><td>1</td><td style="text-align: right">2</td></tr>' +
      '</tbody></table>'
    assert.equal(toClassicTables(fromTipTap), stored)
  })

  void it('leaves a table that already has a thead as it is, apart from the figure', () => {
    assert.equal(
      toClassicTables(
        '<table><thead><tr><th>a</th></tr></thead>' +
          '<tbody><tr><th>b</th></tr><tr><td>1</td></tr></tbody></table>',
      ),
      '<figure class="table"><table><thead><tr><th>a</th></tr></thead>' +
        '<tbody><tr><th>b</th></tr><tr><td>1</td></tr></tbody></table></figure>',
    )
  })
})
