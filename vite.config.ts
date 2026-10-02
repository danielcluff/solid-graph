import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

// Serves and builds the playground (the library itself ships as source).
export default defineConfig({
  root: "playground",
  plugins: [solid(), tailwindcss()],
  server: { port: 5175 },
  build: { target: "esnext", outDir: "../dist", emptyOutDir: true },
});
