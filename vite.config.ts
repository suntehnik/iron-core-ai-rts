import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Dev/preview-server proxy for the cloud (or local) LLM API.
 * The API key lives in .env.local on the server side and never reaches the browser:
 *   LLM_PROXY_TARGET=https://openrouter.ai/api/v1   (any OpenAI-compatible base URL)
 *   LLM_API_KEY=...
 *   LLM_MODEL=qwen/qwen3-30b-a3b-instruct-2507
 * The game talks to /api/llm/* when the "Серверный прокси" provider is selected.
 */
function llmProxy(env: Record<string, string>): Plugin {
  const target = (env.LLM_PROXY_TARGET || '').replace(/\/+$/, '');
  const apiKey = env.LLM_API_KEY || '';
  const model = env.LLM_MODEL || '';

  const handler: Connect.NextHandleFunction = (req: IncomingMessage, res: ServerResponse, next) => {
    if (!req.url || !req.url.startsWith('/api/llm')) return next();
    const path = req.url.slice('/api/llm'.length) || '/';

    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };

    if (path === '/status') {
      let host = '';
      try {
        host = target ? new URL(target).host : '';
      } catch {
        host = target;
      }
      return send(200, { configured: !!target, model, host });
    }
    if (!target) return send(503, { error: { message: 'LLM proxy is not configured: set LLM_PROXY_TARGET in .env.local' } });

    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', async () => {
      try {
        let body: string | undefined;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          body = Buffer.concat(chunks).toString('utf8');
          if (path.startsWith('/chat/completions') && model) {
            const parsed = JSON.parse(body || '{}');
            if (!parsed.model) parsed.model = model;
            body = JSON.stringify(parsed);
          }
        }
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const upstream = await fetch(`${target}${path}`, { method: req.method, headers, body });
        res.statusCode = upstream.status;
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
        res.end(Buffer.from(await upstream.arrayBuffer()));
      } catch (e) {
        send(502, { error: { message: `LLM proxy error: ${e instanceof Error ? e.message : String(e)}` } });
      }
    });
  };

  return {
    name: 'ironcore-llm-proxy',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), llmProxy(env)],
    server: {
      port: 3000,
      host: true,
    },
    build: {
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: { manualChunks: { three: ['three'], react: ['react', 'react-dom'] } },
      },
    },
    test: {
      include: ['tests/**/*.test.ts'],
    },
  };
});
