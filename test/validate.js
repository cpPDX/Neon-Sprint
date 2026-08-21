const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const requiredFiles = ["index.html", "stylesheet.css", "game-core.js", "game.js"];
let failures = 0;

function check(condition, message) {
  if (condition) {
    console.log(`PASS: ${message}`);
  } else {
    console.error(`FAIL: ${message}`);
    failures++;
  }
}

for (const file of requiredFiles) {
  const fullPath = path.join(root, file);
  check(fs.existsSync(fullPath) && fs.statSync(fullPath).size > 0, `${file} exists and is non-empty`);
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const game = fs.readFileSync(path.join(root, "game.js"), "utf8");

check(html.includes("<!DOCTYPE html>"), "index.html declares HTML5");
check(!html.includes("user-scalable=no"), "viewport does not disable zoom");
check(html.includes('id="start-btn"') && html.includes('id="restart-btn"'), "start and restart use buttons");
check(html.includes('id="unlock-dialog"') && html.includes('role="dialog"'), "unlock guidance uses a DOM dialog");
check(html.includes('id="initials-form"'), "initials entry uses a DOM form");
check(
  html.indexOf('src="game-core.js"') < html.indexOf('src="game.js"'),
  "deterministic game core loads before the game",
);
check(!game.includes('code === "Tab"'), "Tab is not bound as a gameplay key");
check(!game.includes('addEventListener("touchstart"'), "legacy single-touch handlers are removed");
check(game.includes('addEventListener("pointerdown"'), "Pointer Events drive touch gameplay");
check(game.includes("createFixedStepClock"), "game loop uses a fixed-step clock");

if (failures > 0) {
  console.error(`\n${failures} validation failure(s)`);
  process.exit(1);
}

console.log("\nStructural validation passed");
