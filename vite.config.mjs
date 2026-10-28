import { readFileSync } from 'node:fs';

export default {
  plugins: [{
    name: 'emit-classic-app-scripts',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'app.js',
        source: readFileSync(new URL('./app.js', import.meta.url), 'utf8'),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'js/script.js',
        source: readFileSync(new URL('./js/script.js', import.meta.url), 'utf8'),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'js/admin-entry.js',
        source: readFileSync(new URL('./js/admin-entry.js', import.meta.url), 'utf8'),
      });
    },
  }],
};
