import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// 版本号只在 package.json 维护一处，打包时注入到页面里
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

const backend = "http://127.0.0.1:8100";

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    host: "127.0.0.1",
    port: 5174,
    proxy: {
      "/api": backend,
      "/media": backend,
    },
  },
});
