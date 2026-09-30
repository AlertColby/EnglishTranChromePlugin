// serve.js —— 极简静态服务器（仅测试用）
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = 18742;

http.createServer((req, res) => {
  const rel = req.url === "/" ? "test-popup.html" : req.url.split("?")[0];
  const file = path.join(ROOT, rel);
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; res.end("not found"); return; }
    res.setHeader("Content-Type", file.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain");
    res.end(data);
  });
}).listen(PORT, () => console.log("serving at http://127.0.0.1:" + PORT));