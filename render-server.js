const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT || 10000);
const API_PORT = 4000;

const root = __dirname;

// Start existing API internally
const api = spawn(process.execPath, [path.join(root, "api", "server.js")], {
  cwd: root,
  stdio: "inherit"
});

api.on("error", err => console.error("API failed:", err));

function proxyApi(req, res) {
  const options = {
    hostname: "127.0.0.1",
    port: API_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${API_PORT}`
    }
  };

  const upstream = http.request(options, response => {
    res.writeHead(response.statusCode || 502, response.headers);
    response.pipe(res);
  });

  upstream.on("error", err => {
    res.writeHead(503, {
      "Content-Type": "application/json"
    });
    res.end(JSON.stringify({
      error: "API unavailable",
      details: err.message
    }));
  });

  req.pipe(upstream);
}

function serveFile(file, res) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(500);
      return res.end("File error");
    }

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });

    res.end(data);
  });
}

const server = http.createServer((req, res) => {

  // API
  if (req.url.startsWith("/api/")) {
    return proxyApi(req, res);
  }

  // Admin
  if (req.url === "/admin" || req.url === "/admin/") {
    return serveFile(
      path.join(root, "admin", "index.html"),
      res
    );
  }

  // Student
  if (req.url === "/" || req.url === "/index.html") {
    return serveFile(
      path.join(root, "student", "index.html"),
      res
    );
  }

  res.writeHead(404, {
    "Content-Type": "text/plain"
  });

  res.end("GrowthOS page not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`GrowthOS LIVE SERVER running on port ${PORT}`);
  console.log(`Student: /`);
  console.log(`Admin: /admin`);
  console.log(`API: /api/health`);
});

process.on("SIGTERM", () => {
  api.kill();
  server.close(() => process.exit(0));
});