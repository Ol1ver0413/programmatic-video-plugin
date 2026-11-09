import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { outputFile } from '../runtime/project.mjs';

async function deadline(work, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Contact-sheet page exceeded 30 seconds; resume to retry')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function makeSheets(page, root, directory, records, onPage, checkCancelled) {
  const pages = [];
  // Bound browser payloads to 16 thumbnails, preserving full-resolution PNGs separately.
  for (let first = 0; first < records.length; first += 16) {
    checkCancelled();
    const items = [];
    for (const record of records.slice(first, first + 16)) {
      const result = spawnSync(
        'ffmpeg',
        [
          '-v',
          'error',
          '-i',
          path.join(root, directory, record.file),
          '-vf',
          'scale=280:158:force_original_aspect_ratio=decrease',
          '-frames:v',
          '1',
          '-f',
          'image2pipe',
          '-c:v',
          'png',
          'pipe:1',
        ],
        { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
      );
      if (result.error || result.status !== 0 || !result.stdout?.length)
        throw new Error(
          result.error?.message || result.stderr?.toString() || 'Thumbnail extraction failed',
        );
      items.push({
        image: result.stdout.toString('base64'),
        label: `#${first + items.length + 1}  ${record.time_requested.toFixed(3)}s`,
      });
    }
    const sheet = await deadline(
      page.evaluate(async (items) => {
        const width = 280,
          height = 158,
          label = 28,
          gap = 8,
          columns = Math.min(4, items.length);
        const canvas = document.createElement('canvas');
        canvas.width = columns * (width + gap) + gap;
        canvas.height = Math.ceil(items.length / columns) * (height + label + gap) + gap;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#131722';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = '14px monospace';
        ctx.textBaseline = 'top';
        for (const [i, item] of items.entries()) {
          const image = new Image();
          image.src = 'data:image/png;base64,' + item.image;
          await image.decode();
          const x = gap + (i % columns) * (width + gap),
            y = gap + Math.floor(i / columns) * (height + label + gap);
          ctx.drawImage(image, x + (width - image.width) / 2, y + (height - image.height) / 2);
          ctx.fillStyle = '#eef1f7';
          ctx.fillText(item.label, x, y + height + 5);
        }
        return canvas.toDataURL('image/png').split(',')[1];
      }, items),
      30000,
    );
    const name = pages.length
      ? `contact-sheet-${String(pages.length + 1).padStart(3, '0')}.png`
      : 'contact-sheet.png';
    await writeFile(await outputFile(root, directory + '/' + name), Buffer.from(sheet, 'base64'));
    pages.push(name);
    await onPage(pages);
  }
  return pages;
}
