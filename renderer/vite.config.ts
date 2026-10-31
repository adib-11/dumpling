import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The main window's renderer. `npm run build` puts it in dist/renderer, which main.ts loads from disk,
// so asset paths are relative.
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../dist/renderer",
    emptyOutDir: true,
  },
})
