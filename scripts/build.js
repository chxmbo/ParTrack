const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const entries = ["index.html", "styles.css", "app.js", "sw.js", "assets", "public"];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const entry of entries) {
  fs.cpSync(path.join(root, entry), path.join(dist, entry), { recursive: true });
}

fs.writeFileSync(path.join(dist, ".nojekyll"), "");
