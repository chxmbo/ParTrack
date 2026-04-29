const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const entries = ["index.html", "styles.css", "app.js", "sw.js", "env-config.js", "assets", "public"];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const entry of entries) {
  fs.cpSync(path.join(root, entry), path.join(dist, entry), { recursive: true });
}

fs.writeFileSync(path.join(dist, ".nojekyll"), "");

const envConfig = {
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "",
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || ""
};

fs.writeFileSync(
  path.join(dist, "env-config.js"),
  `window.PARTRACK_ENV = ${JSON.stringify(envConfig, null, 2)};\n`
);
