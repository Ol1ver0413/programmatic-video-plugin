import path from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export async function openBrowser(projectRoot) {
  let dependency;
  try {
    dependency = createRequire(path.join(projectRoot, 'package.json')).resolve('playwright');
  } catch {
    throw new Error(
      'Install the project rendering dependency first: run npm install in the video project.',
    );
  }
  const runtime = await import(pathToFileURL(dependency).href);
  const chromium = runtime.chromium || runtime.default?.chromium;
  if (!chromium) throw new Error('The project Playwright installation does not expose Chromium.');
  const choices = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const executablePath = choices.find((file) => file && existsSync(file));
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--mute-audio'],
  });
}

export async function loadProjectPage(browser, url, project) {
  const page = await browser.newPage({
      viewport: { width: project.width, height: project.height },
    }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url + '/?render=1');
  await page.waitForFunction(() => window.__ready || window.__error, undefined, { timeout: 60000 });
  const startupError = await page.evaluate(() => window.__error);
  if (startupError) throw new Error(startupError);
  return { page, errors };
}

export async function captureFrame(page, time) {
  return Buffer.from(
    await page.evaluate((seconds) => {
      if (typeof window.__render !== 'function')
        throw new Error(
          'This project does not expose the supported Canvas __render(time) interface.',
        );
      window.__render(seconds);
      return document.querySelector('#film').toDataURL('image/png').split(',')[1];
    }, time),
    'base64',
  );
}
