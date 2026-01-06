const http = require("http");
const fs = require("fs");
const path = require("path");
const { scrapeGrades } = require("./scrape_module");

const PORT = 3000;

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
};

const server = http.createServer(async (req, res) => {
  console.log(`[Request] ${req.method} ${req.url}`);

  // CORS for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // API Endpoint: Scrape
  if (req.url === "/api/scrape" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const { username, password } = JSON.parse(body);
        if (!username || !password) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Username and Password required" }));
          return;
        }

        // Enable streaming
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson", // Newline delimited JSON
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        const logCallback = (msg) => {
          console.log(msg); // Keep server log
          res.write(JSON.stringify({ type: "log", message: msg }) + "\n");
        };

        const data = await scrapeGrades(username, password, logCallback);

        // Send final data
        res.write(JSON.stringify({ type: "result", data: data }) + "\n");
        res.end();
      } catch (error) {
        // If headers sent, write error chunk
        res.write(
          JSON.stringify({ type: "error", message: error.message }) + "\n"
        );
        res.end();
      }
    });
    return;
  }

  // Static File Serving
  let filePath = "." + req.url;
  if (filePath === "./") {
    filePath = "./index.html";
  }

  const extname = path.extname(filePath);
  let contentType = MIME_TYPES[extname] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code == "ENOENT") {
        // 404
        res.writeHead(404);
        res.end("File Not Found");
      } else {
        // 500
        res.writeHead(500);
        res.end("Server Error: " + error.code);
      }
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content, "utf-8");
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(
    `Open your browser to http://localhost:${PORT} to inspect grades.`
  );
});
