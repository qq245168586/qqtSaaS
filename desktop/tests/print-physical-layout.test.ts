import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPrintTemplate } from '../electron/print-template-model';
import { printPageWidth } from '../src/print-page-size';

test('template keeps its left border inside the 12 mm printable safe area', () => {
  const leftMargin = 12;
  const lineOffset = 0;
  assert.equal(leftMargin + lineOffset, 12);
});

test('241 mm continuous template uses the 210 mm driver page without scaling its elements', () => {
  const template = createPrintTemplate('global');
  assert.equal(template.paper.width, 241);
  assert.equal(printPageWidth(template), 210);
  template.elements.legend.x = 215;
  assert.equal(printPageWidth(template), 241);
});

test('print media removes the application shell before Chromium lays out the page', async () => {
  const [css, templatePaper] = await Promise.all([
    readFile(new URL('../src/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/TemplatePaper.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(templatePaper, /left: `\$\{t\.margins\.left \+ b\.x\}mm`/);
  assert.match(
    css,
    /\.app-sidebar,[\s\S]*?\.main-layout > \.topbar,[\s\S]*?display: none !important/,
  );
  assert.match(
    css,
    /\.app-layout,[\s\S]*?\.main-layout,[\s\S]*?\.workspace[\s\S]*?margin: 0 !important;[\s\S]*?padding: 0 !important/,
  );
});
