const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const API_PORT = 4000;
const FILE = path.join(__dirname, 'index.html');

function proxyApi(req, res) {
  const opts = {
    hostname: '127.0.0.1',
    port: API_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` }
  };
  const upstream = http.request(opts, up => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on('error', err => {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: `API unavailable: ${err.message}` }));
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return proxyApi(req, res);
  if (req.url !== '/' && req.url !== '/index.html') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  const html = fs.readFileSync(FILE);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
});

server.listen(PORT, '127.0.0.1', () => console.log(`GrowthOS Student → http://localhost:${PORT}`));
server.on('error', err => { console.error(`Student server error: ${err.message}`); process.exitCode = 1; });
