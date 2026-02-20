import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(__dirname, 'public'), // Absolute path to public
  publicDir: false,
  build: {
    outDir: resolve(__dirname, 'dist_vite'), // Absolute path to dist_vite
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/index.html'),
        mypage: resolve(__dirname, 'public/mypage.html'),
        entry: resolve(__dirname, 'public/entry.html'),
        hair_upload: resolve(__dirname, 'public/hair_upload.html'),
        hair_transform: resolve(__dirname, 'public/hair_transform.html'),
        admin: resolve(__dirname, 'public/admin/index.html'),
        'admin/booking': resolve(__dirname, 'public/admin/booking.html'),
        'admin/customers': resolve(__dirname, 'public/admin/customers.html'),
        'admin/menu': resolve(__dirname, 'public/admin/menu.html'),
        'admin/pos': resolve(__dirname, 'public/admin/pos.html'),
        'admin/sales': resolve(__dirname, 'public/admin/sales.html'),
        'admin/settings': resolve(__dirname, 'public/admin/settings.html'),
        'ai-matching': resolve(__dirname, 'public/ai-matching/index.html'),
        'diagnosis': resolve(__dirname, 'public/diagnosis/index.html'),
        'diagnosis/mobile_upload': resolve(__dirname, 'public/diagnosis/mobile_upload.html'),
        'diagnosis/phase3_viewer_design': resolve(__dirname, 'public/diagnosis/phase3_viewer_design.html'),
        'prompt-generator': resolve(__dirname, 'public/prompt-generator/index.html'),
      },
      output: {
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
});
