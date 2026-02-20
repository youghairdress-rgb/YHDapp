import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/index.html'),
        mypage: resolve(__dirname, 'public/mypage.html'),
        entry: resolve(__dirname, 'public/entry.html'),
        hair_upload: resolve(__dirname, 'public/hair_upload.html'),
        hair_transform: resolve(__dirname, 'public/hair_transform.html'),
      },
      output: {
        // LIFFの強力なキャッシュを回避するため、ファイル名にハッシュを付与
        entryFileNames: `assets/[name]-[hash].js`,
        chunkFileNames: `assets/[name]-[hash].js`,
        assetFileNames: `assets/[name]-[hash].[ext]`
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
});
