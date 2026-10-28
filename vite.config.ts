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
/**
 * The only upstream calls the game makes through the proxy (see LLMClient), with their methods.
 * Matched exactly, so the injected key can't be pointed at other provider endpoints
 * (e.g. `/api/llm/../../keys`).
 */
const PROXY_ROUTES: Record<string, string> = {
  '/models': 'GET',
  '/chat/completions': 'POST',
};
/** Agent prompts are a few KB; anything this big is not a game request. */
const MAX_BODY_BYTES = 1024 * 1024;

export function llmProxy(env: Record<string, string>): Plugin {
  const target = (env.LLM_PROXY_TARGET || '').replace(/\/+$/, '');
  const apiKey = env.LLM_API_KEY || '';
  const model = env.LLM_MODEL || '';

  const handler: Connect.NextHandleFunction = (req: IncomingMessage, res: ServerResponse, next) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname !== '/api/llm' && !pathname.startsWith('/api/llm/')) return next();
    const path = pathname.slice('/api/llm'.length) || '/';

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
    const method = PROXY_ROUTES[path];
    if (!method) return send(404, { error: { message: `LLM proxy: unsupported endpoint ${path}` } });
    if (req.method !== method) {
      res.setHeader('Allow', method);
      return send(405, { error: { message: `LLM proxy: ${path} accepts ${method} only` } });
    }
    if (!target) return send(503, { error: { message: 'LLM proxy is not configured: set LLM_PROXY_TARGET in .env.local' } });

    // Count every byte but keep only the first MAX_BODY_BYTES: an oversized upload is
    // drained and rejected instead of buffered whole in memory.
    const chunks: Buffer[] = [];
    let received = 0;
    req.on('data', (c: Buffer) => {
      received += c.length;
      if (received <= MAX_BODY_BYTES) chunks.push(c);
    });
    req.on('end', async () => {
      if (received > MAX_BODY_BYTES) {
        return send(413, { error: { message: `LLM proxy: request body over ${MAX_BODY_BYTES} bytes` } });
      }
      try {
        let body: string | undefined;
        if (method === 'POST') {
          body = Buffer.concat(chunks).toString('utf8');
          if (model) {
            const parsed = JSON.parse(body || '{}');
            if (!parsed.model) parsed.model = model;
            body = JSON.stringify(parsed);
          }
        }
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const upstream = await fetch(`${target}${path}`, { method, headers, body });
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

/**
 * `vite build --mode ios` packs the game for the iOS app (ios/Web, served from the bundle):
 * a fixed layout width that WebKit scales down to the phone, and no web fonts, so the app works offline.
 */
export const IOS_LAYOUT_WIDTH = 1024;

function iosShell(mode: string): Plugin {
  return {
    name: 'ironcore-ios-shell',
    transformIndexHtml(html) {
      if (mode !== 'ios') return html;
      return html
        .replace(/<meta name="viewport"[^>]*>/, `<meta name="viewport" content="width=${IOS_LAYOUT_WIDTH}, user-scalable=no, viewport-fit=cover" />`)
        // the app is the home-screen icon already: no web app manifest, no Apple web-app tags
        .replace(/\s*<!-- Installable web app[^>]*-->/, '')
        .replace(/\s*<link rel="(manifest|apple-touch-icon)"[^>]*>/g, '')
        .replace(/\s*<meta name="(theme-color|mobile-web-app-capable|apple-mobile-web-app-[\w-]+)"[^>]*>/g, '')
        .replace(/\s*<link rel="preconnect"[^>]*>/g, '')
        .replace(/\s*<link href="https:\/\/fonts\.googleapis\.com[^>]*>/g, '');
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), llmProxy(env), iosShell(mode)],
    // public/ holds the web app manifest and its icons, which the iOS app does not use
    publicDir: mode === 'ios' ? false : 'public',
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
