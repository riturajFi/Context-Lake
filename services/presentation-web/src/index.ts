import { createReadStream, readFileSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface AppConfig {
  host: string;
  port: number;
  serviceName: string;
  ingestApiUrl: string;
  contextQueryApiUrl: string;
  auditWriterUrl: string;
  streamProcessorUrl: string;
}

interface RuntimeTarget {
  id: string;
  name: string;
  kind: 'api' | 'worker';
  url: string;
  livenessPath: string;
  readinessPath: string;
}

interface RuntimeSnapshot {
  generated_at: string;
  system_status: 'healthy' | 'degraded';
  services: Array<{
    id: string;
    name: string;
    kind: 'api' | 'worker';
    url: string;
    liveness: 'up' | 'down';
    readiness: 'up' | 'down';
    details: unknown;
  }>;
}

const currentFile = fileURLToPath(import.meta.url);
const serviceRoot = resolve(currentFile, '..', '..');
const publicDir = join(serviceRoot, 'public');

const config = loadConfig();
const runtimeTargets: RuntimeTarget[] = [
  {
    id: 'ingest-api',
    name: 'Ingest API',
    kind: 'api',
    url: config.ingestApiUrl,
    livenessPath: '/health',
    readinessPath: '/ready',
  },
  {
    id: 'context-query-api',
    name: 'Context Query API',
    kind: 'api',
    url: config.contextQueryApiUrl,
    livenessPath: '/health',
    readinessPath: '/ready',
  },
  {
    id: 'stream-processor',
    name: 'Stream Processor',
    kind: 'worker',
    url: config.streamProcessorUrl,
    livenessPath: '/health',
    readinessPath: '/ready',
  },
  {
    id: 'audit-writer',
    name: 'Audit Writer',
    kind: 'worker',
    url: config.auditWriterUrl,
    livenessPath: '/health',
    readinessPath: '/ready',
  },
];

const server = createServer(async (request, response) => {
  try {
    if (!request.url) {
      sendJson(response, 400, {
        error: 'invalid_request',
        message: 'request url is required',
      });
      return;
    }

    const requestUrl = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);

    if (requestUrl.pathname === '/api/runtime') {
      const snapshot = await buildRuntimeSnapshot(runtimeTargets);
      sendJson(response, 200, snapshot);
      return;
    }

    await serveStaticAsset(requestUrl.pathname, response);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        service: config.serviceName,
        error: error instanceof Error ? error.message : 'unknown error',
      }),
    );
    sendJson(response, 500, {
      error: 'internal_error',
      message: 'presentation server failed to handle the request',
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(
    JSON.stringify({
      level: 'info',
      service: config.serviceName,
      host: config.host,
      port: config.port,
      message: 'presentation web listening',
    }),
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}

function loadConfig(): AppConfig {
  loadEnvFile(join(serviceRoot, '.env'));

  return {
    host: process.env.HOST ?? '0.0.0.0',
    port: Number(process.env.PORT ?? 3010),
    serviceName: process.env.SERVICE_NAME ?? 'presentation-web',
    ingestApiUrl: process.env.INGEST_API_URL ?? 'http://127.0.0.1:3001',
    contextQueryApiUrl: process.env.CONTEXT_QUERY_API_URL ?? 'http://127.0.0.1:3002',
    auditWriterUrl: process.env.AUDIT_WRITER_URL ?? 'http://127.0.0.1:3003',
    streamProcessorUrl: process.env.STREAM_PROCESSOR_URL ?? 'http://127.0.0.1:3004',
  };
}

function loadEnvFile(filePath: string) {
  try {
    const contents = readFileSync(filePath, 'utf8');

    for (const line of contents.split(/\r?\n/u)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      const value = rawValue.replace(/^['"]|['"]$/gu, '');

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // The presentation app can run with shell-provided environment variables instead.
  }
}

async function buildRuntimeSnapshot(targets: RuntimeTarget[]): Promise<RuntimeSnapshot> {
  const serviceSnapshots = await Promise.all(
    targets.map(async (target) => {
      const [liveness, readiness] = await Promise.all([
        fetchJson(`${target.url}${target.livenessPath}`),
        fetchJson(`${target.url}${target.readinessPath}`),
      ]);

      return {
        id: target.id,
        name: target.name,
        kind: target.kind,
        url: target.url,
        liveness: liveness.ok ? 'up' : 'down',
        readiness: readiness.ok ? 'up' : 'down',
        details: readiness.body ?? liveness.body ?? null,
      } as const;
    }),
  );

  return {
    generated_at: new Date().toISOString(),
    system_status: serviceSnapshots.every(
      (service) => service.liveness === 'up' && service.readiness === 'up',
    )
      ? 'healthy'
      : 'degraded',
    services: serviceSnapshots,
  };
}

async function fetchJson(url: string) {
  try {
    const response = await fetch(url);
    const text = await response.text();

    return {
      ok: response.ok,
      body: text ? JSON.parse(text) : null,
    };
  } catch (error) {
    return {
      ok: false,
      body: {
        error: error instanceof Error ? error.message : 'request failed',
      },
    };
  }
}

async function serveStaticAsset(requestPath: string, response: ServerResponse<IncomingMessage>) {
  const relativePath = requestPath === '/' ? '/index.html' : requestPath;
  const safePath = normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    sendText(response, 403, 'forbidden');
    return;
  }

  try {
    await access(filePath);
  } catch {
    if (extname(filePath) === '') {
      const indexPath = join(publicDir, 'index.html');
      const contents = await readFile(indexPath);
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
      });
      response.end(contents);
      return;
    }

    sendText(response, 404, 'not found');
    return;
  }

  response.writeHead(200, {
    'content-type': contentTypeFor(filePath),
  });
  createReadStream(filePath).pipe(response);
}

function contentTypeFor(filePath: string) {
  const extension = extname(filePath);

  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'text/plain; charset=utf-8';
  }
}

function sendJson(response: ServerResponse<IncomingMessage>, statusCode: number, body: unknown) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function sendText(response: ServerResponse<IncomingMessage>, statusCode: number, body: string) {
  response.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
  });
  response.end(body);
}
