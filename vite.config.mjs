import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    root: 'public',
    build: {
        rollupOptions: {
            input: {
                index: resolve('public/index.html')
            }
        }
    }
});
