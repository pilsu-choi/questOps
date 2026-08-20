import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Ports are read from a plain .env in this directory (not the VITE_-prefixed
// client env) so each git worktree can run its own dev server + API pair
// side by side. See ../README.md "Parallel development" section.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const port = Number(env.PORT) || 5173;
  const apiPort = Number(env.API_PORT) || 8787;

  return {
    plugins: [react()],
    server: {
      port,
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true
        }
      }
    }
  };
});
