import { defineConfig } from 'vite';
import { resolve, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getHtmlEntries(dir, baseDir) {
    const entries = {};
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (file === 'dist' || file === 'dist_vite' || file === 'node_modules' || file === '.git') continue;
            Object.assign(entries, getHtmlEntries(fullPath, baseDir));
        } else if (file.endsWith('.html')) {
            const relativePath = relative(baseDir, fullPath);
            let name = relativePath.replace(/\.html$/, '').replace(/\\/g, '/');

            if (name === 'index') {
                name = 'main';
            }

            entries[name] = fullPath;
        }
    }
    return entries;
}

const htmlEntries = getHtmlEntries(resolve(__dirname, 'public'), resolve(__dirname, 'public'));

export default defineConfig({
    root: 'public',
    build: {
        outDir: '../dist_vite',
        emptyOutDir: true,
        rollupOptions: {
            input: htmlEntries
        }
    }
});
