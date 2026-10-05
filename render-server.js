const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const PUBLIC_PORT = process.env.PORT || 10000;

const API_PORT = 4000;
const ADMIN_PORT = 3000;
const STUDENT_PORT = 3001;

const root = __dirname;

const services = [
  ['API', 'api/server.js', API_PORT],
  ['ADMIN', 'admin/server.js', ADMIN_PORT],
  ['STUDENT', 'student/server.js', STUDENT_PORT]
];

const children = [];

for (const [name, file, port] of services) {
  const child = spawn(
    process.execPath,
    [path.join(root, file)],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env
      }
    }
  );

  children.push(child);

  child.on('error', err => {
    console.error(`[${name}] failed: ${err.message}`);
  });

  child.on('exit', code => {
    console.log(`[${name}] exited with code ${code}`);
  });
}

function proxy(req, res, port, targetPath = null) {
  const options = {
    hostname: '127.0.0.1',
    port,
    path: targetPath || req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${port}`
    }
  };

  const upstream = http.request(options, response => {
    res.writeHead(response.statusCode || 502, response.headers);
    response.pipe(res);
  });

  upstream.on('error', err => {
    console.error(`Proxy error on port ${port}:`, err.message);

    if (!res.headersSent) {
      res.writeHead(503, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
    }

    res.end(JSON.stringify({
      error: 'GrowthOS service temporarily unavailable',
      details: err.message
    }));
  });

  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  const pathname = url.pathname;

  /*
   * API
   *
   * /api/... ? API server :4000
   */
  if (pathname.startsWith('/api/')) {
    return proxy(req, res, API_PORT);
  }

  /*
   * ADMIN
   *
   * /admin
   * /admin/
   * /admin/index.html
   *
   * ? Admin server :3000
   */
  if (
    pathname === '/admin' ||
    pathname === '/admin/' ||
    pathname === '/admin/index.html'
  ) {
    const query = url.search || '';

    return proxy(
      req,
      res,
      ADMIN_PORT,
      '/index.html' + query
    );
  }

  /*
   * STUDENT
   *
   * Everything else ? Student server :3001
   */
  return proxy(req, res, STUDENT_PORT);
});

server.listen(PUBLIC_PORT, '0.0.0.0', () => {
  console.log('');
  console.log('========================================');
  console.log('       GrowthOS PUBLIC SERVER');
  console.log('========================================');
  console.log(`Public:  http://localhost:${PUBLIC_PORT}`);
  console.log(`Student: http://localhost:${PUBLIC_PORT}/`);
  console.log(`Admin:   http://localhost:${PUBLIC_PORT}/admin`);
  console.log(`API:     http://localhost:${PUBLIC_PORT}/api/health`);
  console.log('');
  console.log(`Internal API:     http://localhost:${API_PORT}`);
  console.log(`Internal Admin:   http://localhost:${ADMIN_PORT}`);
  console.log(`Internal Student: http://localhost:${STUDENT_PORT}`);
  console.log('========================================');
  console.log('');
});

function shutdown() {
  console.log('\nShutting down GrowthOS...');

  for (const child of children) {
    try {
      child.kill();
    } catch {}
  }

  try {
    server.close();
  } catch {}

  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
