// Comprehensive browser integration test for speech audio controller and button states.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

(async () => {
  let serverProcess = null;
  // Ensure acceptance fixture on port 10292 is running
  const isServerUp = async () => {
    try {
      const res = await fetch('http://127.0.0.1:10292/', { signal: AbortSignal.timeout(1000) });
      return res.ok;
    } catch {
      return false;
    }
  };

  if (!(await isServerUp())) {
    serverProcess = spawn(process.execPath, ['tests/acceptance.mjs'], {
      stdio: 'inherit',
      cwd: process.cwd()
    });
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (await isServerUp()) break;
    }
  }

  assert.ok(await isServerUp(), 'Acceptance server on 10292 must be reachable');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    // Intercept translation and printer endpoints for stability
    await page.route('**/api/translate', route => {
      const q = route.request().postDataJSON()?.q;
      route.fulfill({ json: { text: q === '早上好' ? 'good morning' : 'hello', provider: 'test', cached: false, ms: 1 } });
    });
    await page.route('**/api/printer/**', route => {
      route.fulfill({ json: { connected: true, busy: false, detail: '测试设备' } });
    });

    // Install controllable fake SpeechSynthesis in page
    await page.addInitScript(() => {
      window.fakeSpeech = {
        cancelCount: 0,
        speakCount: 0,
        currentUtterance: null,
        utteranceHistory: [],
        speaking: false,
        pending: false,
        paused: false,
        voices: [{ name: 'Samantha', lang: 'en-US', localService: true }]
      };

      window.SpeechSynthesisUtterance = class {
        constructor(text) {
          this.text = text;
          this.lang = 'en-US';
          this.rate = 1;
          this.voice = null;
          this.onstart = null;
          this.onend = null;
          this.onerror = null;
        }
      };

      const fakeSynth = {
        get speaking() { return window.fakeSpeech.speaking; },
        get pending() { return window.fakeSpeech.pending; },
        get paused() { return window.fakeSpeech.paused; },
        getVoices() { return window.fakeSpeech.voices; },
        cancel() {
          window.fakeSpeech.cancelCount++;
          window.fakeSpeech.speaking = false;
          window.fakeSpeech.pending = false;
          window.fakeSpeech.paused = false;
        },
        speak(u) {
          window.fakeSpeech.speakCount++;
          window.fakeSpeech.currentUtterance = u;
          window.fakeSpeech.utteranceHistory.push(u);
          window.fakeSpeech.speaking = true;
          // Synchronously or via microtask simulate onstart
          queueMicrotask(() => { if (u.onstart) u.onstart(); });
        },
        addEventListener(event, fn) {
          if (event === 'voiceschanged') window.fakeSpeech._voicesChanged = fn;
        }
      };

      Object.defineProperty(window, 'speechSynthesis', {
        value: fakeSynth,
        configurable: true
      });
    });

    await page.goto('http://127.0.0.1:10292/');

    // 1. Clean start & First click verification
    const speakBtn = page.locator('#speak');
    await page.waitForFunction(() => $('word').value === 'good morning' && !$('speak').disabled);

    // Initial state: not pressed, volume icon
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(await speakBtn.getAttribute('aria-label'), '朗读英文');
    assert.ok(await speakBtn.locator('i.icon-volume').count() === 1);
    assert.ok(await speakBtn.locator('i.icon-stop').count() === 0);
    assert.ok(!(await speakBtn.evaluate(el => el.classList.contains('speaking'))), 'Idle button must not have speaking class');

    // Clean start verification: cancelCount should be 0 before any click
    assert.equal(await page.evaluate(() => window.fakeSpeech.cancelCount), 0);

    // Click #speak for the first time
    await speakBtn.click();

    // Verify: Empty queue first-click MUST NOT call cancel()
    assert.equal(await page.evaluate(() => window.fakeSpeech.cancelCount), 0, 'Clean start first click must not call cancel()');
    assert.equal(await page.evaluate(() => window.fakeSpeech.speakCount), 1);
    assert.equal(await page.evaluate(() => window.fakeSpeech.currentUtterance.text), 'good morning');

    // Immediate active state verification: speaker icon is KEPT while playing
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(await speakBtn.getAttribute('aria-label'), '正在朗读英文');
    assert.ok(await speakBtn.locator('i.icon-volume').count() === 1, 'Playing button must keep the volume icon');
    assert.ok(await speakBtn.locator('i.icon-stop').count() === 0, 'Playing button must NOT swap to a square stop icon');
    assert.ok(await speakBtn.evaluate(el => el.classList.contains('speaking')), 'Playing button must have speaking class');

    // Verify visual design token styling and animated playing feedback on playing button
    const styles = await speakBtn.evaluate(el => {
      const s = getComputedStyle(el);
      return {
        color: s.color,
        background: s.backgroundColor,
        boxShadow: s.boxShadow,
        iconAnimation: getComputedStyle(el.querySelector('.icon')).animationName,
        rippleAnimation: getComputedStyle(el, '::before').animationName,
        rippleBorder: getComputedStyle(el, '::before').borderTopColor
      };
    });
    assert.ok(styles.boxShadow.includes('2px'), 'Active button must have ring box-shadow');
    assert.equal(styles.iconAnimation, 'speech-pulse', 'Playing icon must pulse');
    assert.equal(styles.rippleAnimation, 'speech-ripple', 'Playing button must show expanding ripple rings');
    assert.ok(styles.rippleBorder.includes('23, 101, 239') || styles.rippleBorder.includes('rgb(23, 101, 239)'), 'Ripple rings must use accent color');

    // 2. Normal completion (onend)
    await page.evaluate(() => window.fakeSpeech.currentUtterance.onend());
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(await speakBtn.getAttribute('aria-label'), '朗读英文');
    assert.ok(await speakBtn.locator('i.icon-volume').count() === 1);
    assert.ok(await speakBtn.locator('i.icon-stop').count() === 0);
    assert.ok(!(await speakBtn.evaluate(el => el.classList.contains('speaking'))), 'Finished button must drop speaking class');
    assert.equal(await speakBtn.evaluate(el => getComputedStyle(el, '::before').animationName), 'none', 'Ripple must stop after completion');

    // 3. Quick repeat click while playing: audio must NOT stop and NOT replay
    await speakBtn.click();
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'true');
    const speakCountBeforeRepeat = await page.evaluate(() => window.fakeSpeech.speakCount);
    const cancelCountBeforeRepeat = await page.evaluate(() => window.fakeSpeech.cancelCount);
    await speakBtn.click(); // quick second click on the same button
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'true', 'Repeat click must keep playing');
    assert.ok(await speakBtn.evaluate(el => el.classList.contains('speaking')), 'Repeat click must keep speaking state');
    assert.equal(await page.evaluate(() => window.fakeSpeech.speakCount), speakCountBeforeRepeat, 'Repeat click must not re-speak');
    assert.equal(await page.evaluate(() => window.fakeSpeech.cancelCount), cancelCountBeforeRepeat, 'Repeat click must not cancel');
    await page.evaluate(() => window.fakeSpeech.currentUtterance.onend());
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'false');
    assert.ok(!(await speakBtn.evaluate(el => el.classList.contains('speaking'))), 'Toggled-off button must drop speaking class');

    // 4. Error handling
    await speakBtn.click();
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'true');
    // Dispatch error
    await page.evaluate(() => window.fakeSpeech.currentUtterance.onerror({ error: 'audio-busy' }));
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'false');
    assert.ok(await speakBtn.locator('i.icon-volume').count() === 1);
    assert.match(await page.locator('#status').textContent(), /朗读失败/);

    // Canceled/interrupted error should silently reset without error message
    await page.evaluate(() => $('status').textContent = '');
    await speakBtn.click();
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.fakeSpeech.currentUtterance.onerror({ error: 'canceled' }));
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#status').textContent(), '');

    // 5. Watchdog timeout on silent drop (H1 WebKit bug regression)
    await speakBtn.click();
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'true');
    // Advance timers or wait 6.1s for watchdog
    await page.waitForTimeout(6200);
    // Watchdog must reset the button to idle
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'false', 'Watchdog must reset button to idle');
    assert.ok(await speakBtn.locator('i.icon-volume').count() === 1);
    assert.ok(!(await speakBtn.evaluate(el => el.classList.contains('speaking'))), 'Watchdog reset must drop speaking class');
    // User can immediately click to speak again after silent drop
    const prevCount = await page.evaluate(() => window.fakeSpeech.speakCount);
    await speakBtn.click();
    assert.equal(await page.evaluate(() => window.fakeSpeech.speakCount), prevCount + 1);
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.fakeSpeech.currentUtterance.onend());

    // 6. Entry 2: #speakSample on Settings page
    await page.locator('#settingsTab').click();
    const sampleBtn = page.locator('#speakSample');
    assert.equal(await sampleBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(await sampleBtn.getAttribute('aria-label'), '朗读预览英文');
    assert.ok(await sampleBtn.locator('i.icon-volume').count() === 1);

    await sampleBtn.click();
    assert.equal(await sampleBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(await sampleBtn.getAttribute('aria-label'), '正在朗读预览英文');
    assert.ok(await sampleBtn.locator('i.icon-volume').count() === 1, 'Sample button must keep volume icon while playing');
    assert.equal(await sampleBtn.evaluate(el => getComputedStyle(el, '::before').animationName), 'speech-ripple', 'Sample button must show ripple while playing');
    const expectedSample = await page.locator('#sampleWord').inputValue();
    assert.equal(await page.evaluate(() => window.fakeSpeech.currentUtterance.text), expectedSample);

    // Clicking #speakSample again while playing must be ignored (no stop, no replay)
    const sampleSpeakCountBefore = await page.evaluate(() => window.fakeSpeech.speakCount);
    const sampleCancelCountBefore = await page.evaluate(() => window.fakeSpeech.cancelCount);
    await sampleBtn.click();
    assert.equal(await page.evaluate(() => window.fakeSpeech.speakCount), sampleSpeakCountBefore, 'Repeat click on sample must not re-speak');
    assert.equal(await page.evaluate(() => window.fakeSpeech.cancelCount), sampleCancelCountBefore, 'Repeat click on sample must not cancel');
    assert.equal(await sampleBtn.getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.fakeSpeech.currentUtterance.onend());
    assert.equal(await sampleBtn.getAttribute('aria-pressed'), 'false');

    // 7. Cross-entry preemption: Only one button active at any time
    await sampleBtn.click();
    assert.equal(await sampleBtn.getAttribute('aria-pressed'), 'true');
    // Switch to Print page and click #speak
    await page.locator('#printTab').click();
    assert.equal(await sampleBtn.getAttribute('aria-pressed'), 'false', 'Page change must reset speech');
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'false');

    await speakBtn.click();
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'true');

    // 8. Entry 3 & 4: Button factory P0Speech.button() and [data-speak-text]
    const cardBtn = await page.evaluateHandle(() => {
      const b = window.P0Speech.button('elephant');
      document.body.append(b);
      return b;
    });
    assert.equal(await cardBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(await cardBtn.getAttribute('aria-label'), '朗读 elephant');

    await cardBtn.click();
    assert.equal(await cardBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(await cardBtn.getAttribute('aria-label'), '正在朗读 elephant');
    // #speak should now be idle because cardBtn preempted it
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'false');

    await page.evaluate(() => window.fakeSpeech.currentUtterance.onend());
    assert.equal(await cardBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(await cardBtn.getAttribute('aria-label'), '朗读 elephant');

    // 9. Visibility change & Background lifecycle
    await speakBtn.click();
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'true');
    // Simulate backgrounding (visibilitychange -> hidden)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'false', 'Backgrounding must stop speech and reset button');

    // Simulate returning to foreground
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'false');
    // Next click works immediately
    await speakBtn.click();
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.fakeSpeech.currentUtterance.onend());
    assert.equal(await speakBtn.getAttribute('aria-pressed'), 'false');

    // 10. Unsupported browser verification
    const unsupportedPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await unsupportedPage.addInitScript(() => {
      delete window.speechSynthesis;
      delete window.SpeechSynthesisUtterance;
    });
    await unsupportedPage.goto('http://127.0.0.1:10292/');
    assert.ok(await unsupportedPage.locator('#speak').isDisabled());
    assert.ok(await unsupportedPage.locator('#speakSample').isDisabled());
    await unsupportedPage.close();

    assert.deepEqual(errors, [], 'No unexpected page errors');
    console.log('PASS speech lifecycle: clean start (no cancel), speaker icon kept with ripple animation while playing, repeat click ignored while playing, watchdog recovery, preemption, visibilitychange, unsupported fallback.');
  } finally {
    await browser.close();
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
