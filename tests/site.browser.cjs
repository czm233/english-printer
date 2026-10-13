// Run after: node scripts/site-acceptance.mjs up
// Pure-static product page. No device/model API or real printer is used.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const base = 'http://127.0.0.1:10293/english-printer/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    await fs.mkdir('work/site-checks', { recursive: true });
    const page = await browser.newPage();
    const errors = [], badResponses = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) badResponses.push(response.url()); });
    page.on('request', request => requests.push(request.url()));
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 720, height: 500 }, { width: 390, height: 844 }, { width: 390, height: 664 }, { width: 320, height: 664 }]) {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await page.goto(base);
        for (const image of await page.locator('img[loading="lazy"]').all()) await image.scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.equal(await page.locator('.button').evaluateAll(elements => new Set(elements.map(element => getComputedStyle(element).fontSize)).size), 1);
        assert(await page.locator('button, .button, summary').evaluateAll(elements => elements.filter(e => e.getClientRects().length).every(e => e.getBoundingClientRect().height >= 44)));
        assert.equal(await page.locator('button').first().evaluate(e => getComputedStyle(e).userSelect), 'none');
        assert.equal(await page.locator('.hero-description').evaluate(e => getComputedStyle(e).userSelect), 'auto');
        await page.locator('[data-word="fridge"]').click();
        assert.equal(await page.locator('#demo-word').textContent(), 'fridge');
        assert.equal(await page.locator('#demo-ipa').textContent(), '/frɪdʒ/');
        assert.equal(await page.locator('[aria-pressed="true"]').count(), 1);
        await page.locator('[data-word="chair"]').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#demo-word').textContent(), 'chair');
        for (const item of await page.locator('details').all()) {
          await item.locator('summary').click();
          assert(await item.evaluate(e => e.open));
          await item.locator('summary').click();
        }
        await page.locator('h1').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `work/site-checks/${colorScheme}-${viewport.width}-${viewport.height}.png`, fullPage: true });
      }
    }
    const anchorTargets = await page.locator('a[href^="#"]').evaluateAll(elements => elements.map(e => e.getAttribute('href')).filter(h => h !== '#'));
    for (const target of anchorTargets) assert.equal(await page.locator(target).count(), 1, target);
    const links = await page.locator('a[target="_blank"]').evaluateAll(elements => elements.map(e => ({ href: e.href, rel: e.rel })));
    assert(links.every(link => link.href.startsWith('https://github.com/czm233/english-printer') && link.rel.includes('noopener')));
    assert(!requests.some(url => url.includes('/api/') || new URL(url).origin !== new URL(base).origin));
    assert.deepEqual(errors, []);
    assert.deepEqual(badResponses, []);

    // Exercise browser speech lifecycle without depending on installed audio voices.
    const speech = await browser.newPage();
    await speech.addInitScript(() => {
      window.speechMock = { cancelled: 0 };
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      Object.defineProperty(window, 'speechSynthesis', { value: {
        cancel() { window.speechMock.cancelled++; },
        getVoices() { return []; },
        speak(utterance) { window.speechMock.utterance = utterance; },
      }});
    });
    await speech.goto(base);
    await speech.locator('#listen').click();
    assert(await speech.locator('#listen').isDisabled());
    assert.equal(await speech.evaluate(() => speechMock.utterance.text), 'mug');
    await speech.evaluate(() => speechMock.utterance.onend());
    assert(await speech.locator('#listen').isEnabled());
    await speech.locator('#listen').click();
    await speech.evaluate(() => speechMock.utterance.onerror());
    assert.match(await speech.locator('#speech-status').textContent(), /暂不可用/);
    assert(await speech.locator('#listen').isEnabled());
    await speech.locator('#listen').click();
    await speech.locator('[data-word="lamp"]').click();
    await speech.evaluate(() => speechMock.utterance.onerror());
    assert.equal(await speech.locator('#speech-status').textContent(), '');
    assert.equal(await speech.locator('#demo-word').textContent(), 'lamp');

    const unsupported = await browser.newPage();
    await unsupported.addInitScript(() => { delete window.SpeechSynthesisUtterance; });
    await unsupported.goto(base);
    assert(await unsupported.locator('#listen').isDisabled());
    assert.match(await unsupported.locator('#speech-status').textContent(), /不支持/);
    await unsupported.locator('[data-word="fridge"]').click();
    assert.equal(await unsupported.locator('#demo-word').textContent(), 'fridge');

    const noScript = await browser.newPage({ javaScriptEnabled: false });
    await noScript.goto(base);
    assert(await noScript.locator('h1').isVisible());
    await noScript.locator('details').first().locator('summary').click();
    assert(await noScript.locator('details').first().evaluate(e => e.open));
    assert(await noScript.locator('noscript').isVisible());
    assert(await noScript.locator('#listen').isDisabled());
    assert(await noScript.locator('[data-word="mug"]').isDisabled());
    console.log('PASS product page: responsive light/dark, images, typography, targets, keyboard, FAQ, anchors, local-only requests, speech success/error/cancel/unsupported, no-JS fallback.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
