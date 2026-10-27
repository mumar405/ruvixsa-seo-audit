import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHtml } from '../audit-core.mjs';

const good = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><title>Example page</title>
<meta name="description" content="A useful page description.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://example.com/">
<meta property="og:title" content="Example"><meta property="og:description" content="A page">
<meta property="og:image" content="https://example.com/image.png"><meta property="og:url" content="https://example.com/">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Example"}</script>
</head><body><h1>Example</h1><h2>Details</h2><img src="/image.png" alt="An example"><a href="/about">About</a></body></html>`;

test('same HTML and same metadata produces deterministic checks and score', () => {
  const a = analyzeHtml(good, 'https://example.com/', { status: 200 });
  const b = analyzeHtml(good, 'https://example.com/', { status: 200 });
  assert.deepEqual(a.checks, b.checks);
  assert.deepEqual(a.score, b.score);
});

test('real source changes are reflected in checks and score', () => {
  const broken = good.replace('<title>Example page</title>', '<title></title><title>Duplicate</title>')
    .replace('alt="An example"', '');
  const before = analyzeHtml(broken, 'https://example.com/', { status: 200 });
  const after = analyzeHtml(good, 'https://example.com/', { status: 200 });
  assert.equal(before.checks.find(c => c.name === 'Title tag').status, 'Issue');
  assert.equal(before.checks.find(c => c.name === 'Image alt attributes').status, 'Issue');
  assert.equal(after.checks.find(c => c.name === 'Title tag').status, 'Pass');
  assert.equal(after.checks.find(c => c.name === 'Image alt attributes').status, 'Pass');
  assert.ok(after.score.score > before.score.score);
});

test('malformed quoted attributes, duplicate attributes and invalid JSON-LD are detected', () => {
  const html = '<html lang="en"><head><script type="application/ld+json">{"@type":}</script></head><body><img src="x" src="y" alt="x"><div title="unfinished></body></html>';
  const r = analyzeHtml(html, 'https://example.com/', { status: 200 });
  assert.equal(r.checks.find(c => c.name === 'JSON-LD syntax').status, 'Issue');
  assert.equal(r.checks.find(c => c.name === 'HTML source integrity').status, 'Issue');
  assert.ok(r.markupFindings.some(f => f.kind === 'duplicate-attribute'));
  assert.ok(r.markupFindings.some(f => f.kind === 'quote'));
});

test('Not Tested checks are excluded from score and local re-test does not claim HTTP success', () => {
  const r = analyzeHtml('<html lang="en"><head><title>Example</title></head><body><h1>Example</h1></body></html>', 'https://example.com/', { local: true });
  assert.equal(r.checks.find(c => c.name === 'HTTP response').status, 'Not Tested');
  assert.equal(r.checks.find(c => c.name === 'Rendered JavaScript / Core Web Vitals').status, 'Not Tested');
  assert.equal(r.score.excludedNotTested, r.checks.filter(c => c.status === 'Not Tested').length);
});


test('measurable absence of optional metadata is Review, not Not Tested', () => {
  const html = '<html lang="en"><head><meta charset="utf-8"><title>Example</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Example</h1></body></html>';
  const r = analyzeHtml(html, 'https://example.com/', { status: 200 });
  for (const name of ['Canonical URL', 'Robots directives', 'JSON-LD syntax', 'Structured data type presence']) {
    assert.equal(r.checks.find(c => c.name === name).status, 'Review', name);
  }
  assert.equal(r.checks.find(c => c.name === 'Image alt attributes').status, 'Not Tested');
  assert.equal(r.checks.find(c => c.name === 'HTTP response').status, 'Pass');
});

test('character encoding checks UTF-8 declaration placement and duplicates', () => {
  const goodEncoding = analyzeHtml('<!doctype html><html><head><meta charset="utf-8"><title>Example</title></head><body></body></html>', 'https://example.com/', { status: 200 });
  assert.equal(goodEncoding.checks.find(c => c.name === 'Character encoding').status, 'Pass');
  const lateEncoding = analyzeHtml('<!doctype html><html><head><title>Example</title>' + ' '.repeat(1100) + '<meta charset="utf-8"></head><body></body></html>', 'https://example.com/', { status: 200 });
  assert.equal(lateEncoding.checks.find(c => c.name === 'Character encoding').status, 'Issue');
});

test('link markup reports missing href and empty accessible names; Open Graph validates URL format', () => {
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Example</title><meta property="og:title" content="Example"><meta property="og:description" content="Description"><meta property="og:image" content="/relative.png"><meta property="og:url" content="https://example.com/"></head><body><a> </a><a href="/about">About</a></body></html>';
  const r = analyzeHtml(html, 'https://example.com/', { status: 200 });
  const links = r.checks.find(c => c.name === 'Link markup');
  const og = r.checks.find(c => c.name === 'Open Graph tags');
  assert.equal(links.status, 'Issue');
  assert.match(links.evidence, /1 without href/);
  assert.match(links.evidence, /possibly unnamed link/);
  assert.equal(og.status, 'Issue');
  assert.match(og.evidence, /og:image absolute HTTP\(S\) URL: invalid/);
});


test('robots none directive is treated as noindex', () => {
  const html = '<html lang="en"><head><meta charset="utf-8"><title>Example</title><meta name="robots" content="none"></head><body></body></html>';
  const r = analyzeHtml(html, 'https://example.com/', { status: 200 });
  const robots = r.checks.find(c => c.name === 'Robots directives');
  assert.equal(robots.status, 'Issue');
  assert.match(robots.evidence, /noindex\/none directive was detected/);
});

test('an unnamed anchor without missing href is Review, not a definite error', () => {
  const html = '<html lang="en"><head><meta charset="utf-8"><title>Example</title></head><body><a href="/menu"><svg></svg></a></body></html>';
  const r = analyzeHtml(html, 'https://example.com/', { status: 200 });
  const links = r.checks.find(c => c.name === 'Link markup');
  assert.equal(links.status, 'Review');
  assert.match(links.evidence, /0 without href/);
  assert.match(links.evidence, /possibly unnamed link/);
});
