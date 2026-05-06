const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "public/icons");
const iconSvg = path.join(root, "assets/icon.svg");

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(iconSvg, path.join(outDir, "icon-192.svg"));
fs.copyFileSync(iconSvg, path.join(outDir, "icon-512.svg"));

for (const size of [192, 512]) {
  const png = path.join(outDir, `icon-${size}.png`);
  if (!fs.existsSync(png)) {
    console.warn(`Missing ${path.relative(root, png)}. Resize assets/partrack-mark.png to ${size}x${size}.`);
  }
}
