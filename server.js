// Serves the Helm landing page. No dependencies.
// Env vars:
//   HELM_CA       $HELM contract address (0x...). Buy buttons then open its Pons page.
//   WAITLIST_URL  Google Apps Script web app URL that saves signups.
//   PORT          set by Railway.
const http = require("http");
const fs = require("fs");
const path = require("path");

const ca = (process.env.HELM_CA || "").trim();
const waitlist = (process.env.WAITLIST_URL || "").trim();
if (ca && !/^0x[a-fA-F0-9]{40}$/.test(ca)) console.warn("HELM_CA is not a valid 0x address, ignoring it:", ca);
if (waitlist && !/^https:\/\/\S+$/.test(waitlist)) console.warn("WAITLIST_URL must start with https://, ignoring it");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8")
  .replace("__HELM_CA__", /^0x[a-fA-F0-9]{40}$/.test(ca) ? ca : "")
  .replace("__WAITLIST_URL__", /^https:\/\/\S+$/.test(waitlist) ? JSON.stringify(waitlist).slice(1, -1) : "");

const files = {
  "/logo.png": "image/png",
  "/og.png": "image/png",
  "/x-banner.png": "image/png",
};

http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  if (url === "/health") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }
  if (files[url]) {
    return fs.readFile(path.join(__dirname, url), (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": files[url], "Cache-Control": "public, max-age=86400" });
      res.end(buf);
    });
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(html);
}).listen(process.env.PORT || 3000, () => {
  console.log("Helm site on port " + (process.env.PORT || 3000) + (/^0x[a-fA-F0-9]{40}$/.test(ca) ? " | CA " + ca : " | no CA set") + (/^https:\/\/\S+$/.test(waitlist) ? " | waitlist on" : " | waitlist NOT saving"));
});
