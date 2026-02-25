import { build } from 'vite';

const debugPlugin = {
  name: 'debug-plugin',
  enforce: 'pre',
  buildStart() { console.error('[TRACE] buildStart'); },
  moduleParsed(info) { console.error('[TRACE] moduleParsed:', info.id); },
  buildEnd(err) { console.error('[TRACE] buildEnd', err || 'no error'); },
  renderStart() { console.error('[TRACE] renderStart'); },
  renderChunk(code, chunk) { console.error('[TRACE] renderChunk:', chunk.fileName); return null; },
  generateBundle() { console.error('[TRACE] generateBundle'); },
  writeBundle() { console.error('[TRACE] writeBundle'); },
  closeBundle() { console.error('[TRACE] closeBundle'); },
};

async function run() {
  try {
    await build({
      configFile: './vite.config.mjs',
      logLevel: 'silent',
      plugins: [debugPlugin]
    });
    console.error('BUILD SUCCESS');
  } catch (err) {
    console.error('BUILD FATAL ERROR:', err);
  }
}

run();
