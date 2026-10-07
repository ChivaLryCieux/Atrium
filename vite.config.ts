import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  optimizeDeps: {
    entries: ["index.html"],
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/deepseek-harness/**",
        "**/.kernel-build/**",
        "**/.kernel-dist/**",
        "**/packages/**",
        "**/ZCode/**",
      ],
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-3d": ["three", "@react-three/fiber", "ogl"],
          "vendor-term": ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-web-links"],
          "vendor-md": ["react-markdown", "remark-gfm"],
        },
      },
    },
  },
});
