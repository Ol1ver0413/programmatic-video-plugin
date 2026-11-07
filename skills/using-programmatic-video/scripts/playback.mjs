import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { outputFile, checkAndWrite } from '../assets/starter/tools/project.mjs';
import { startServer } from '../assets/starter/tools/server.mjs';
import { openBrowser, captureFrame } from '../assets/starter/tools/browser.mjs';
import { saveJson } from './files.mjs';

// Uses the starter's public player interface; it does not judge the film's content.
export async function checkPlayback(directory) {
  const root = await realpath(directory);
  const reportPath = await outputFile(root, 'output/qa/playback.json');
  const started = performance.now();
  const report = {
    ok: false,
    source: 'Canvas player, not encoded video',
    stage: 'static validation',
    scenes: [],
    caption_checks: 0,
    deterministic_times: [],
    browser_errors: [],
    limitations:
      'Runtime checks do not assess likeness, natural motion, comedy, word-level alignment or user acceptance.',
  };
  let server, browser;
  try {
    const { project, cues } = await checkAndWrite(root);
    report.duration_seconds = project.duration;
    const served = await startServer(0, root);
    server = served.server;
    browser = await openBrowser(root);
    const page = await browser.newPage();
    page.on('pageerror', (error) => report.browser_errors.push(error.message));
    report.stage = 'startup';
    await page.goto(served.url);
    await page.waitForFunction(() => window.__ready || window.__error);
    const startupError = await page.evaluate(() => window.__error);
    if (startupError) throw new Error(startupError);
    assert.ok(
      await page.evaluate(
        () =>
          typeof window.__render === 'function' &&
          window.__playback &&
          document.querySelector('#play') &&
          document.querySelector('#scrub') &&
          document.querySelector('#film'),
      ),
      'Playback validation requires the starter __render/__playback and #film/#play/#scrub interface',
    );

    report.stage = 'scene rendering';
    for (const scene of project.scenes) {
      const time = (scene.start + scene.end) / 2;
      const evidence = await page.evaluate((t) => window.__render(t), time);
      assert.equal(evidence.scene, scene.id, `Scene at ${time}`);
      report.scenes.push({ id: scene.id, time });
      const hash = async () =>
        createHash('sha256')
          .update(await captureFrame(page, time))
          .digest('hex');
      assert.equal(await hash(), await hash(), `Non-deterministic render at ${time}`);
      report.deterministic_times.push(time);
    }
    report.stage = 'captions';
    for (const cue of cues) {
      const delta = Math.min(0.005, (cue.end - cue.start) / 4);
      for (const time of [cue.start + delta, (cue.start + cue.end) / 2, cue.end - delta]) {
        const evidence = await page.evaluate((t) => window.__render(t), time);
        assert.equal(
          evidence.caption,
          project.burnCaptions === false ? '' : cue.text,
          `Caption at ${time}`,
        );
        report.caption_checks++;
      }
    }
    const seek = async (time) => {
      await page.locator('#scrub').evaluate((el, value) => {
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, time);
      await page.waitForFunction((t) => Math.abs(window.__playback.time - t) < 0.06, time);
    };
    report.stage = 'play and pause';
    await seek(0);
    await page.click('#play');
    await page.waitForFunction(() => window.__playback.playing && window.__playback.time > 0);
    await page.click('#play');
    assert.equal(await page.evaluate(() => window.__playback.playing), false, 'Pause');
    report.stage = 'seek';
    await seek(project.duration / 2);
    report.seek_seconds = await page.evaluate(() => window.__playback.time);
    await seek(0);
    report.stage = 'full playback';
    await page.click('#play');
    await page.waitForFunction(
      (duration) => !window.__playback.playing && window.__playback.time >= duration - 0.06,
      project.duration,
      { timeout: Math.ceil(project.duration * 1000) + 10000 },
    );
    report.playback = await page.evaluate(() => {
      const audio = document.querySelector('audio');
      return {
        time: window.__playback.time,
        playing: window.__playback.playing,
        audio_duration: Number.isFinite(audio?.duration) ? audio.duration : null,
        audio_ended: audio?.ended ?? null,
      };
    });
    if (project.audio && report.playback.audio_duration <= project.duration + 0.05)
      assert.equal(
        report.playback.audio_ended,
        true,
        'Equal-length audio must reach its native ended event',
      );
    assert.deepEqual(report.browser_errors, []);
    report.stage = 'complete';
    report.ok = true;
  } catch (error) {
    report.error = error.message;
    throw new Error(`Playback validation failed: ${error.message}. Report: ${reportPath}`, {
      cause: error,
    });
  } finally {
    try {
      await browser?.close();
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      report.elapsed_seconds = Number(((performance.now() - started) / 1000).toFixed(3));
      await saveJson(reportPath, report);
    }
  }
  return { ...report, report: path.relative(root, reportPath).replaceAll('\\', '/') };
}
