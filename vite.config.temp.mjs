import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: resolve(__dirname, 'dist_vite'),
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        admin_index: resolve(__dirname, 'public/admin/index.html'),
        admin_booking: resolve(__dirname, 'public/admin/booking.html'),
        admin_customers: resolve(__dirname, 'public/admin/customers.html'),
        admin_pos: resolve(__dirname, 'public/admin/pos.html'),
        admin_sales: resolve(__dirname, 'public/admin/sales.html'),
        admin_settings: resolve(__dirname, 'public/admin/settings.html'),
        admin_menu: resolve(__dirname, 'public/admin/menu.html'),
      }
    }
  }
});
