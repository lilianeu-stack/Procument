import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import resolveConfig from 'tailwindcss/resolveConfig.js';
import tailwindConfig from '../tailwind.config.js';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const srcRoot = fileURLToPath(new URL('../src', import.meta.url));

function collect(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collect(path, files);
    else if (/\.(jsx?|css)$/.test(name)) files.push(path);
  }
  return files;
}

const sourceFiles = collect(srcRoot);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('all text resolves through the canonical black token', () => {
  const css = read('../src/index.css');
  assert.match(css, /--text-primary:\s*#000000\s*;/i);
  assert.match(css, /--pims-ink:\s*var\(--text-primary\)/);
  assert.match(css, /--pims-interaction-green-text:\s*var\(--text-primary\)/);
  assert.match(css, /:\s*root[\s\S]*?color:\s*var\(--text-primary\)/);
  assert.match(css, /body \{[\s\S]*?color:\s*var\(--text-primary\)/);
  assert.match(css, /input::placeholder, textarea::placeholder \{ color: var\(--text-primary\) !important; opacity: 1 !important; \}/);
  assert.match(css, /::selection \{ background: var\(--pims-reference\); color: var\(--text-primary\); \}/);
  assert.match(css, /\.pims-sidebar-badge \{\s*color: #FFFFFF !important;\s*\}/);
  assert.match(read('../src/components/ui/SidebarBadge.jsx'), /pims-sidebar-badge/);
});

test('hover and group-hover text stay black while green surfaces remain', () => {
  const css = read('../src/index.css');
  assert.match(css, /background-color: var\(--pims-interaction-tint\) !important;[\s\S]*?color: var\(--text-primary\) !important;/);
  assert.match(css, /\.group:hover \[class\*='group-hover:text-black'\] \{\s*color: var\(--text-primary\) !important;/);
  assert.match(css, /label:hover[\s\S]*?color: var\(--text-primary\) !important;/);
  assert.doesNotMatch(css, /color:\s*#456921/i);
  assert.match(css, /background-color: var\(--pims-disabled-surface\) !important;[\s\S]*?opacity: 1 !important;/);
});

test('Tailwind text utilities are remapped to the black token, not the colored palette', () => {
  const config = read('../tailwind.config.js');
  assert.match(config, /const blackText = 'var\(--text-primary\)'/);
  assert.match(config, /textColor:\s*\{[\s\S]*?\.\.\.blackTextPalette[\s\S]*?\}/);
  for (const token of ['ink', 'muted', 'canvas', 'reference', 'success', 'hover', 'brand', 'accent']) {
    assert.match(config, new RegExp(`${token}:\\s*(?:blackText|\\{[^}]*blackText)`, 'g'), `${token} text should be black`);
  }
  assert.doesNotMatch(config, /text-white|#456921/);

  const resolved = resolveConfig(tailwindConfig).theme.textColor;
  assert.equal(resolved.black, 'var(--text-primary)');
  assert.equal(resolved.white, 'var(--text-primary)');
  assert.equal(resolved.slate['700'], 'var(--text-primary)');
  assert.equal(resolved.emerald['800'], 'var(--text-primary)');
  assert.equal(resolved.accent.text, 'var(--text-primary)');
});

test('no source file uses a colored or translucent text utility', () => {
  const forbiddenTextClass = /(?:^|[\s'"`])(?:(?:hover|focus|group-hover|disabled|sm|md|lg|xl|2xl):)*!?text-(?:white|muted|ink|brand(?:-[a-z]+)?|canvas|reference|success|hover|accent(?:-[a-z]+)?|(?:slate|gray|grey|zinc|neutral|red|green|emerald|amber|sky|blue|indigo|rose|orange|yellow|violet|purple|pink|teal|cyan|lime|stone)-\d{2,3}|black\/\d+)/;
  for (const file of sourceFiles) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, forbiddenTextClass, `${file} still uses a colored text utility`);
    assert.doesNotMatch(source, /style=\{\{[^}]*\bcolor\s*:/, `${file} still uses an inline text color`);
    if (!file.endsWith('SidebarBadge.jsx') && !file.endsWith('index.css')) {
      assert.doesNotMatch(source, /pims-sidebar-badge/, `${file} must not opt into the badge-only white text exception`);
    }
  }
});

test('dark text surfaces are replaced by light neutral or status-tinted surfaces', () => {
  const jsxFiles = sourceFiles.filter((file) => file.endsWith('.jsx'));
  const forbiddenSurface = /\bbg-(?:red-600|slate-(?:800|900|950)|gray-(?:800|900)|zinc-(?:800|900)|neutral-(?:800|900)|green-(?:700|800)|emerald-(?:700|800|900))\b/;
  for (const file of jsxFiles) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), forbiddenSurface, `${file} still renders text on a dark surface`);
  }
});

test('login copy is not greyed out by opacity', () => {
  const login = read('../src/pages/LoginPage.css');
  for (const selector of [
    '.login-intro > p:last-child',
    '.login-input-icon',
    '.login-input::placeholder',
    '.login-password-toggle',
    '.login-security-note',
    '.login-visual-description',
    '.login-flow-heading small',
    '.login-activity-copy small',
    '.login-float small',
    '.login-visual-footer'
  ]) {
    const block = login.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`))?.[1] || '';
    assert.doesNotMatch(block, /opacity:\s*0\./, `${selector} must render at full opacity`);
  }
  assert.match(login, /\.login-submit:disabled \{[\s\S]*?background: var\(--pims-disabled-surface\)/);
});

test('print and PDF output force black text with a color-only rule', () => {
  const css = read('../src/index.css');
  assert.match(css, /\*, ::before, ::after \{\s*color: var\(--text-primary\) !important;\s*-webkit-text-fill-color: var\(--text-primary\) !important;/);
  const printBlock = css.match(/@media print \{[\s\S]*?\*, ::before, ::after \{[\s\S]*?\}\s*\}/)?.[0] || '';
  assert.match(printBlock, /color: var\(--text-primary\) !important/);
  assert.match(css, /\.official-document \{[\s\S]*?color: var\(--text-primary\)/);
});
