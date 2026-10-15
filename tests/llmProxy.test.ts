import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Connect } from 'vite';
import { llmProxy } from '../vite.config';

interface Seen {
  method?: string;
  url?: string;
  auth?: string;
  body: string;
}

describe('dev-server LLM proxy', () => {
  let upstream: http.Server;
  let proxy: http.Server;
  let proxyPort = 0;
  const seen: Seen[] = [];

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>(r => upstream.listen(0, '127.0.0.1', () => r()));
    const target = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`;

    let handler!: Connect.NextHandleFunction;
    const plugin = llmProxy({ LLM_PROXY_TARGET: target, LLM_API_KEY: 'secret', LLM_MODEL: 'qwen-test' });
    (plugin.configureServer as (s: unknown) => void)({ middlewares: { use: (h: Connect.NextHandleFunction) => (handler = h) } });
    proxy = http.createServer((req, res) =>
      handler(req, res, () => {
        res.statusCode = 404;
        res.end('vite');
      }),
    );
    await new Promise<void>(r => proxy.listen(0, '127.0.0.1', () => r()));
    proxyPort = (proxy.address() as AddressInfo).port;
  });
  afterAll(() => {
    proxy.close();
    upstream.close();
  });
  beforeEach(() => {
    seen.length = 0;
  });

  // Raw http.request, not fetch: fetch would normalize `..` before sending.
  const request = (method: string, path: string, body?: string) =>
    new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: proxyPort, method, path }, res => {
        let text = '';
        res.on('data', c => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      });
      req.on('error', reject);
      req.end(body);
    });

  it('forwards chat completions with the server key and default model', async () => {
    const res = await request('POST', '/api/llm/chat/completions', '{"messages":[]}');
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/v1/chat/completions', auth: 'Bearer secret' });
    expect(JSON.parse(seen[0].body)).toEqual({ messages: [], model: 'qwen-test' });
  });

  it('forwards the model list', async () => {
    expect((await request('GET', '/api/llm/models')).status).toBe(200);
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/v1/models' });
  });

  it('refuses other endpoints, including path traversal', async () => {
    expect((await request('GET', '/api/llm/../../keys')).status).toBe(404);
    expect((await request('POST', '/api/llm/chat/completions/../../../keys', '{}')).status).toBe(404);
    expect((await request('GET', '/api/llm/embeddings')).status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it('refuses the wrong method for a known endpoint', async () => {
    expect((await request('GET', '/api/llm/chat/completions')).status).toBe(405);
    expect((await request('DELETE', '/api/llm/models')).status).toBe(405);
    expect(seen).toHaveLength(0);
  });

  it('rejects oversized bodies without forwarding them', async () => {
    const res = await request('POST', '/api/llm/chat/completions', 'x'.repeat(2 * 1024 * 1024));
    expect(res.status).toBe(413);
    expect(seen).toHaveLength(0);
  });

  it('leaves non-proxy paths to Vite', async () => {
    expect((await request('GET', '/api/llmfoo')).text).toBe('vite');
  });
});
