import path from 'node:path';
import { parseArgs } from 'node:util';
import { root as defaultRoot } from './server.mjs';
import { renderProject } from './render-core.mjs';
import { renderIncremental } from './render-incremental.mjs';
try {
  const options = Object.fromEntries(
    ['project', 'scene', 'start', 'duration', 'out', 'profile'].map((key) => [
      key,
      { type: 'string' },
    ]),
  );
  for (const key of ['stills', 'no-stills', 'cache', 'incremental'])
    options[key] = { type: 'boolean' };
  const { values, positionals } = parseArgs({ options });
  if (positionals.length) throw new Error('Unexpected renderer arguments');
  const render = values.incremental ? renderIncremental : renderProject;
  console.log(
    JSON.stringify(await render(path.resolve(values.project || defaultRoot), values), null, 2),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
