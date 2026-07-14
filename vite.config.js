import { defineConfig } from 'vite';

export default defineConfig({
  base: '/migration-app-beta/',
  build: {
    chunkSizeWarningLimit: 16000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (
            id.includes('@arcgis/core') ||
            id.includes('@arcgis/map-components') ||
            id.includes('@esri/calcite-components')
          ) {
            return 'esri';
          }
          return undefined;
        }
      }
    }
  }
});