import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
    root: 'public',
    build: {
        outDir: '../dist_vite',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'public/index.html'),
                admin: resolve(__dirname, 'public/admin/index.html'),
                customers: resolve(__dirname, 'public/admin/customers.html'),
                booking: resolve(__dirname, 'public/admin/booking.html'),
                menu: resolve(__dirname, 'public/admin/menu.html'),
                pos: resolve(__dirname, 'public/admin/pos.html'),
                sales: resolve(__dirname, 'public/admin/sales.html'),
                settings: resolve(__dirname, 'public/admin/settings.html'),
                diagnosis: resolve(__dirname, 'public/diagnosis/index.html'),
                aimatching: resolve(__dirname, 'public/ai-matching/index.html'),
                hairupload: resolve(__dirname, 'public/hair_upload.html'),
                hairtransform: resolve(__dirname, 'public/hair_transform.html'),
                mypage: resolve(__dirname, 'public/mypage.html')
            }
        }
    }
});