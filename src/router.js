/**
 * A tiny router: `GET /api/jobs/:id` style patterns compiled to regexes,
 * plus middleware that runs before every matched route.
 */
export class Router {
  #routes = [];
  #middleware = [];

  use(fn) {
    this.#middleware.push(fn);
    return this;
  }

  on(method, pattern, handler) {
    const keys = [];
    const source = pattern
      .split('/')
      .map((part) => {
        if (part.startsWith(':')) {
          keys.push(part.slice(1));
          return '([^/]+)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.#routes.push({ method, regex: new RegExp(`^${source}/?$`), keys, handler });
    return this;
  }

  get(pattern, handler) {
    return this.on('GET', pattern, handler);
  }

  post(pattern, handler) {
    return this.on('POST', pattern, handler);
  }

  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.#routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) continue;
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return { handler: route.handler, params };
    }
    return { handler: null, params: {}, status: pathMatched ? 405 : 404 };
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { handler, params, status } = this.match(req.method, url.pathname);
    const ctx = { req, res, url, params, query: url.searchParams };

    for (const mw of this.#middleware) {
      if ((await mw(ctx)) === false || res.writableEnded) return;
    }
    if (!handler) return sendJson(res, status, { error: status === 405 ? 'Method not allowed' : 'Not found' });
    await handler(ctx);
  }
}

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}
