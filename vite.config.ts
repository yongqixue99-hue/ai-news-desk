import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4317,
  },
  build: {
    outDir: "dist",
    rolldownOptions: {
      output: {
        codeSplitting: {
          minSize: 24_000,
          maxSize: 360_000,
          groups: [
            { name: "tiptap", test: /node_modules\/(?:@tiptap|prosemirror-)/ },
            { name: "react-core", test: /node_modules\/(?:react|react-dom|scheduler)\// },
          ],
        },
      },
    },
  },
});
