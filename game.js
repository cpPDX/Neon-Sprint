const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const {
  FIXED_STEP_MS,
  advanceActiveRunTime,
  advanceScore,
  createFixedStepClock,
  createPointerInputState,
  normalizeInitials,
  rectanglesOverlap,
  shouldUnlock,
} = window.NeonSprintCore;

const GAME_WIDTH = 800;
const GAME_HEIGHT = 350;
let pixelRatio = 1;
const frameClock = createFixedStepClock();
const pointerInput = createPointerInputState();
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let prefersReducedMotion = reducedMotionQuery.matches;

reducedMotionQuery.addEventListener?.("change", (event) => {
  prefersReducedMotion = event.matches;
});

const GROUND_Y = 290;
const GRAVITY = 0.6;
const JUMP_FORCE = -13;
const INITIAL_SPEED = 5;
const MAX_SPEED = 14;

// Difficulty milestones – mechanics unlock before speed ramps up
const TUNNEL_SCORE = 400;         // Score to start spawning underground tunnels
const ADVANCED_PHASE_SCORE = 800; // Score threshold to unlock double jump + firewalls
const JETPACK_SCORE = 1200;       // Score to unlock jetpack hover

// Speed / intensity milestones (kick in after all mechanics are available)
const SPEED_TIER_SCORE = 1500;
const FAST_DRONE_SCORE = 2000;
const COMBO_OBSTACLE_SCORE = 2500;

// ── Shooting / projectile constants ──
const BULLET_SPEED = 10;
const BULLET_WIDTH = 12;
const BULLET_HEIGHT = 3;
const SHOOT_COOLDOWN = 12; // frames between shots (~0.2s)
const DRONE_KILL_SCORE = 50;

// ── Time-of-day cycle ──
// Each "period" lasts a score range. The cycle loops.
const TIME_PERIODS = [
  { name: "DUSK",         scoreLen: 300,  sky: ["#1a0825","#2e1248","#441868"], starAlpha: 0.15, moonAlpha: 0.06, haze: "rgba(120,30,80,0.08)", roadGlow: "#ff00ff" },
  { name: "NIGHT",        scoreLen: 350,  sky: ["#020208","#060614","#0c0c24"], starAlpha: 0.6,  moonAlpha: 0.15, haze: null,                   roadGlow: "#ff00ff" },
  { name: "ACID RAIN",    scoreLen: 350,  sky: ["#061010","#0c1820","#142830"], starAlpha: 0.05, moonAlpha: 0.03, haze: "rgba(0,255,80,0.07)",  roadGlow: "#00ff66" },
  { name: "MIDNIGHT",     scoreLen: 400,  sky: ["#000004","#030310","#08081c"], starAlpha: 0.8,  moonAlpha: 0.20, haze: null,                   roadGlow: "#cc00ff" },
  { name: "NEON FOG",     scoreLen: 350,  sky: ["#100818","#1e1030","#2c1848"], starAlpha: 0.1,  moonAlpha: 0.05, haze: "rgba(180,0,255,0.08)", roadGlow: "#ff00cc" },
  { name: "STORM",        scoreLen: 400,  sky: ["#080818","#101028","#181838"], starAlpha: 0.02, moonAlpha: 0.02, haze: "rgba(100,100,180,0.06)", roadGlow: "#6666ff" },
  { name: "LATE NIGHT",   scoreLen: 350,  sky: ["#020206","#060612","#0a0a20"], starAlpha: 0.7,  moonAlpha: 0.18, haze: null,                   roadGlow: "#ff00ff" },
  { name: "PRE-DAWN",     scoreLen: 300,  sky: ["#140820","#201038","#301850"], starAlpha: 0.35, moonAlpha: 0.10, haze: "rgba(100,40,80,0.06)", roadGlow: "#ff44aa" },
];
const TIME_CYCLE_LEN = TIME_PERIODS.reduce((s, p) => s + p.scoreLen, 0);

function getCurrentTimePeriod() {
  let cycleScore = score % TIME_CYCLE_LEN;
  for (const period of TIME_PERIODS) {
    if (cycleScore < period.scoreLen) return period;
    cycleScore -= period.scoreLen;
  }
  return TIME_PERIODS[0];
}

// Get blend factor (0-1) of how far into the current period we are
function getTimePeriodProgress() {
  let cycleScore = score % TIME_CYCLE_LEN;
  for (const period of TIME_PERIODS) {
    if (cycleScore < period.scoreLen) return cycleScore / period.scoreLen;
    cycleScore -= period.scoreLen;
  }
  return 0;
}

// ── Weather state ──
let weatherParticles = [];
let lightningTimer = 0;
let lightningFlash = 0;

const PLAYER_WIDTH = 36;
const PLAYER_HEIGHT = 50;
const DUCK_HEIGHT = 25;
const DOUBLE_JUMP_FORCE = -11;

// Underground tunnel constants
const UNDERGROUND_Y = 340;        // Ground level inside tunnel (50px below GROUND_Y)
const TUNNEL_CEILING_Y = 40;      // Top of tunnel visual ceiling for immersive mode

// Jetpack constants
const JETPACK_MAX_FUEL = 100;
const JETPACK_BURN_RATE = 1.2;    // per frame (~83 frames = ~1.4 sec)
const JETPACK_RECHARGE_RATE = 0.8; // per frame on ground

// Mobile / touch detection
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// Leaderboard helpers (localStorage with in-memory cache)
let _leaderboardCache = null;
function loadLeaderboard() {
  if (_leaderboardCache) return _leaderboardCache;
  try {
    const saved = JSON.parse(localStorage.getItem("neonSprintLeaderboard"));
    _leaderboardCache = Array.isArray(saved)
      ? saved
        .filter((entry) => entry && Number.isFinite(Number(entry.score)))
        .map((entry) => ({
          initials: normalizeInitials(entry.initials) || "---",
          score: Math.max(0, Math.floor(Number(entry.score))),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
      : [];
  } catch { _leaderboardCache = []; }
  return _leaderboardCache;
}
function saveLeaderboard(board) {
  _leaderboardCache = board;
  try { localStorage.setItem("neonSprintLeaderboard", JSON.stringify(board)); } catch {}
}
function isHighScore(s) {
  const board = loadLeaderboard();
  return board.length < 5 || s > board[board.length - 1].score;
}
function insertScore(initials, s) {
  const board = loadLeaderboard();
  board.push({ initials, score: s });
  board.sort((a, b) => b.score - a.score);
  saveLeaderboard(board.slice(0, 5));
}
function renderLeaderboardHTML(containerId) {
  const container = document.getElementById(containerId);
  const board = loadLeaderboard();
  const title = document.createElement("div");
  title.className = "leaderboard-title";
  title.textContent = "TOP RUNNERS";
  container.replaceChildren(title);

  if (board.length === 0) {
    const empty = document.createElement("p");
    empty.className = "lb-empty";
    empty.textContent = "NO SCORES YET";
    container.append(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "leaderboard-table";
  table.setAttribute("aria-label", "Top runners");
  const body = document.createElement("tbody");
  board.forEach((entry, index) => {
    const row = body.insertRow();
    const rank = row.insertCell();
    const initials = row.insertCell();
    const scoreCell = row.insertCell();
    rank.className = "lb-rank";
    initials.className = "lb-initials";
    scoreCell.className = "lb-score";
    rank.textContent = `${index + 1}.`;
    initials.textContent = normalizeInitials(entry.initials) || "---";
    scoreCell.textContent = String(Number(entry.score) || 0).padStart(6, "0");
  });
  table.append(body);
  container.append(table);
}

// Game state: start | playing | paused | gameover | entering_initials
let state = "start";
let score = 0;
let highScore = (loadLeaderboard()[0] || {}).score || 0;
let gameSpeed = INITIAL_SPEED;
let frameCount = 0;
let obstacles = [];
let particles = [];
let groundOffset = 0;
let tunnelUnlocked = false;     // tracks if we've shown the tunnel unlock notification
let tunnelFlashTimer = 0;
let doubleJumpUnlocked = false; // tracks if we've shown the unlock notification
let unlockFlashTimer = 0;
let difficultyTier = ""; // current difficulty tier label
let resumeGraceFrames = 0; // brief collision immunity after unpausing
let touchHintTimer = 0; // frames to show touch zone hints after game start
let isFirstStart = true; // true only for the very first game after page load
let activeRunTimeMs = 0;
let simulationTimeMs = 0;
let deathReason = "Signal lost";
let previouslyFocusedElement = null;

// Jetpack state
let jetpackUnlocked = false;
let jetpackFuel = JETPACK_MAX_FUEL;
let jetpackActive = false;
let jetpackFlashTimer = 0;
let jumpKeyReleased = false;

// Underground tunnel state
let tunnel = null;      // { x, entranceWidth, bodyWidth, exitWidth }
let playerUnderground = false; // is the player currently below GROUND_Y?
let tunnelObstacleTimer = 0;
let tunnelExitGrace = 0;  // frames of obstacle-spawn grace after exiting tunnel
let wasUnderground = false; // track transition for grace period

// Shooting state
let projectiles = [];   // { x, y, vx }
let shootCooldown = 0;
let droneKills = 0;     // total drones destroyed this run
let killFlashTimer = 0; // screen flash on kill
let lastKillText = "";  // "+50" popup
let currentTimePeriodName = ""; // track for transition detection
let timePeriodFlashTimer = 0;  // flash when period changes

// Unlock tutorial pause state
let unlockPause = null; // { title, lines, color } when active

// Countdown state (after dismissing unlock pause dialogs)
let countdownTimer = 0;        // frames remaining in countdown
let countdownNumber = 0;       // current number to display (3, 2, 1)
const COUNTDOWN_SECONDS = 3;
const FRAMES_PER_SECOND = Math.round(1000 / FIXED_STEP_MS);
let lastCountdownNumber = 0;

// Stats tracking
let maxSpeedReached = 0;
let screenShake = 0; // frames of shake remaining
let deathFlash = 0; // frames of red flash on death

const elements = {
  startScreen: document.getElementById("start-screen"),
  gameOverScreen: document.getElementById("game-over-screen"),
  pauseScreen: document.getElementById("pause-screen"),
  startButton: document.getElementById("start-btn"),
  restartButton: document.getElementById("restart-btn"),
  resumeButton: document.getElementById("resume-btn"),
  quitButton: document.getElementById("quit-btn"),
  unlockDialog: document.getElementById("unlock-dialog"),
  unlockTitle: document.getElementById("unlock-title"),
  unlockDescription: document.getElementById("unlock-description"),
  unlockConfirmButton: document.getElementById("unlock-confirm-btn"),
  initialsDialog: document.getElementById("initials-dialog"),
  initialsForm: document.getElementById("initials-form"),
  initialsInput: document.getElementById("initials-input"),
  initialsDeathReason: document.getElementById("initials-death-reason"),
  soundToggle: document.getElementById("sound-toggle"),
  hapticsToggle: document.getElementById("haptics-toggle"),
};

const DEATH_MESSAGES = {
  barrier: "Hit a traffic barrier",
  bollard: "Clipped a street bollard",
  server: "Hit a server rack",
  drone: "Struck by a patrol drone",
  firewall: "Blocked by a firewall",
  pipe: "Hit an underground pipe",
  puddle_zap: "Stepped in an electrified puddle",
  laser_grid: "Caught in a laser grid",
  steam_vent: "Hit by a steam vent",
  hanging_wire: "Caught by a hanging wire",
  barrel_stack: "Crashed into toxic barrels",
  crusher: "Caught in the tunnel crusher",
  toxic_cloud: "Overwhelmed by toxic gas",
};

function loadBooleanPreference(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? fallback : saved === "true";
  } catch {
    return fallback;
  }
}

function saveBooleanPreference(key, value) {
  try { localStorage.setItem(key, String(value)); } catch {}
}

let soundEnabled = loadBooleanPreference("neonSprintSound", true);
let hapticsEnabled = loadBooleanPreference("neonSprintHaptics", true);
let audioContext = null;

function ensureAudioContext() {
  if (!soundEnabled) return null;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    audioContext ||= new AudioContext();
    if (audioContext.state === "suspended") audioContext.resume();
    return audioContext;
  } catch {
    return null;
  }
}

function playCue(name) {
  if (!soundEnabled) return;
  const audio = ensureAudioContext();
  if (!audio) return;

  const cues = {
    start: [220, 440, 0.14, "sawtooth", 0.035],
    jump: [360, 620, 0.09, "square", 0.025],
    slide: [150, 90, 0.08, "sawtooth", 0.02],
    shoot: [760, 420, 0.05, "square", 0.018],
    destroy: [180, 720, 0.11, "sawtooth", 0.035],
    hit: [120, 45, 0.28, "sawtooth", 0.06],
    unlock: [420, 840, 0.24, "triangle", 0.045],
    countdown: [520, 520, 0.06, "square", 0.025],
    go: [620, 980, 0.1, "square", 0.03],
  };
  const [startFrequency, endFrequency, duration, type, volume] = cues[name] || cues.start;
  const now = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(startFrequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function vibrateCue(name) {
  if (!hapticsEnabled || typeof navigator.vibrate !== "function") return;
  const patterns = {
    jump: 8,
    slide: 6,
    shoot: 5,
    destroy: [8, 12, 8],
    hit: [35, 25, 55],
    unlock: [15, 25, 15],
  };
  if (patterns[name]) navigator.vibrate(patterns[name]);
}

function feedback(name) {
  playCue(name);
  vibrateCue(name);
}

function updateFeedbackButtons() {
  elements.soundToggle.setAttribute("aria-pressed", String(soundEnabled));
  elements.soundToggle.textContent = soundEnabled ? "Sound On" : "Sound Off";
  const hapticsSupported = typeof navigator.vibrate === "function";
  elements.hapticsToggle.hidden = !hapticsSupported;
  elements.hapticsToggle.setAttribute("aria-pressed", String(hapticsEnabled));
  elements.hapticsToggle.textContent = hapticsEnabled ? "Haptics On" : "Haptics Off";
}

function loadSeenTutorials() {
  try {
    const saved = JSON.parse(localStorage.getItem("neonSprintTutorialsSeen"));
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function hasSeenTutorial(type) {
  return Boolean(loadSeenTutorials()[type]);
}

function markTutorialSeen(type) {
  const seen = loadSeenTutorials();
  seen[type] = true;
  try { localStorage.setItem("neonSprintTutorialsSeen", JSON.stringify(seen)); } catch {}
}

function visualTimeMs() {
  return prefersReducedMotion ? 0 : simulationTimeMs;
}

function trapFocus(container, event) {
  if (event.key !== "Tab") return;
  const focusable = [...container.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hidden && element.offsetParent !== null);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    last.focus();
    event.preventDefault();
  } else if (!event.shiftKey && document.activeElement === last) {
    first.focus();
    event.preventDefault();
  }
}

[elements.pauseScreen, elements.unlockDialog, elements.initialsDialog].forEach((dialog) => {
  dialog.addEventListener("keydown", (event) => trapFocus(dialog, event));
});

function restoreGameFocus() {
  const target = previouslyFocusedElement?.isConnected ? previouslyFocusedElement : canvas;
  previouslyFocusedElement = null;
  target.focus?.({ preventScroll: true });
}

// City background layers (parallax)
const buildings = [];
const farBuildings = [];

function generateWindowColors(w, h) {
  const winW = 3, winH = 4;
  const cols = Math.floor(w / 10);
  const rows = Math.floor(h / 14);
  const colors = [];
  for (let r = 1; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = 4 + c * 10;
      const wy = 6 + r * 14;
      const lit = Math.sin(wx * 13.7 + wy * 7.3) > 0;
      if (lit) {
        const flicker = Math.random() > 0.98;
        colors.push({
          r, c,
          color: flicker
            ? "#ffaa00"
            : `rgba(${180 + Math.random() * 75}, ${150 + Math.random() * 60}, ${50 + Math.random() * 200}, 0.7)`,
        });
      }
    }
  }
  return colors;
}

function generateBuildings() {
  buildings.length = 0;
  farBuildings.length = 0;

  // Far layer (silhouettes)
  let x = 0;
  while (x < GAME_WIDTH + 200) {
    const w = 30 + Math.random() * 60;
    const h = 60 + Math.random() * 120;
    farBuildings.push({
      x,
      w,
      h,
      windows: Math.random() > 0.3,
      windowColors: generateWindowColors(w, h),
      color: `hsl(${260 + Math.random() * 30}, 30%, ${8 + Math.random() * 6}%)`,
    });
    x += w + Math.random() * 10;
  }

  // Near layer
  x = 0;
  while (x < GAME_WIDTH + 200) {
    const w = 40 + Math.random() * 70;
    const h = 40 + Math.random() * 90;
    buildings.push({
      x,
      w,
      h,
      windows: Math.random() > 0.2,
      windowColors: generateWindowColors(w, h),
      antenna: Math.random() > 0.6,
      color: `hsl(${240 + Math.random() * 40}, 25%, ${12 + Math.random() * 8}%)`,
      glowColor: ["#ff00ff", "#00ffcc", "#ff6600", "#00aaff"][Math.floor(Math.random() * 4)],
    });
    x += w + Math.random() * 15;
  }
}

generateBuildings();

// Player
const player = {
  x: 80,
  y: GROUND_Y - PLAYER_HEIGHT,
  width: PLAYER_WIDTH,
  height: PLAYER_HEIGHT,
  vy: 0,
  jumping: false,
  ducking: false,
  trailTimer: 0,
  jumpsUsed: 0,    // 0 = grounded, 1 = single jumped, 2 = double jumped
  canDoubleJump: false,
};

// Input
const keys = {};
const justPressed = {}; // Track fresh key presses for double jump
const GAMEPLAY_KEYS = new Set(["Space", "ArrowUp", "ArrowDown", "KeyW", "KeyS", "KeyX", "KeyK"]);

document.addEventListener("keydown", (event) => {
  if (event.code === "Escape") {
    if (state === "playing") {
      pauseGame();
    } else if (state === "paused" && !unlockPause && countdownTimer <= 0) {
      resumeGame();
    }
    event.preventDefault();
    return;
  }

  if (state !== "playing") return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;

  if (!keys[event.code]) justPressed[event.code] = true;
  keys[event.code] = true;

  if (GAMEPLAY_KEYS.has(event.code)) event.preventDefault();
  if (event.code === "KeyX" || event.code === "KeyK") {
    shootProjectile();
  }
});

document.addEventListener("keyup", (event) => {
  keys[event.code] = false;
});

// Convert touch/click position from screen coords to canvas-internal coords
function screenToCanvas(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = GAME_WIDTH / rect.width;
  const scaleY = GAME_HEIGHT / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function getPointerAction(position) {
  if (position.x > GAME_WIDTH * 0.66) return "shoot";
  return position.y < GAME_HEIGHT / 2 ? "jump" : "slide";
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" || state !== "playing") return;
  event.preventDefault();
  try { canvas.setPointerCapture(event.pointerId); } catch {}

  const action = getPointerAction(screenToCanvas(event.clientX, event.clientY));
  const result = pointerInput.press(event.pointerId, action);
  if (action === "jump" && result.becameActive) justPressed.PointerJump = true;
  if (action === "shoot") shootProjectile();
});

function releasePointer(event) {
  if (event.pointerType !== "mouse") event.preventDefault();
  pointerInput.release(event.pointerId);
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
canvas.addEventListener("lostpointercapture", releasePointer);

function confirmInitials(event) {
  event?.preventDefault();
  const initials = normalizeInitials(elements.initialsInput.value);
  if (initials.length !== 3) {
    elements.initialsInput.setCustomValidity("Enter exactly three letters.");
    elements.initialsInput.reportValidity();
    return;
  }
  elements.initialsInput.setCustomValidity("");
  insertScore(initials, Math.floor(score));
  state = "gameover";
  elements.initialsDialog.classList.add("hidden");
  showGameOverScreen();
}

function resetGameState() {
  score = 0;
  gameSpeed = INITIAL_SPEED;
  frameCount = 0;
  obstacles = [];
  particles = [];
  groundOffset = 0;
  player.y = GROUND_Y - PLAYER_HEIGHT;
  player.height = PLAYER_HEIGHT;
  player.vy = 0;
  player.jumping = false;
  player.ducking = false;
  player.jumpsUsed = 0;
  player.canDoubleJump = false;
  tunnelUnlocked = false;
  tunnelFlashTimer = 0;
  doubleJumpUnlocked = false;
  unlockFlashTimer = 0;
  jetpackUnlocked = false;
  jetpackFuel = JETPACK_MAX_FUEL;
  jetpackActive = false;
  jetpackFlashTimer = 0;
  jumpKeyReleased = false;
  tunnel = null;
  playerUnderground = false;
  tunnelObstacleTimer = 0;
  tunnelExitGrace = 0;
  wasUnderground = false;
  difficultyTier = "";
  weatherParticles = [];
  lightningTimer = 0;
  lightningFlash = 0;
  projectiles = [];
  shootCooldown = 0;
  droneKills = 0;
  killFlashTimer = 0;
  lastKillText = "";
  currentTimePeriodName = "";
  timePeriodFlashTimer = 0;
  unlockPause = null;
  countdownTimer = 0;
  countdownNumber = 0;
  lastCountdownNumber = 0;
  maxSpeedReached = INITIAL_SPEED;
  activeRunTimeMs = 0;
  simulationTimeMs = 0;
  deathReason = "Signal lost";
  screenShake = 0;
  deathFlash = 0;
  pointerInput.clear();
  Object.keys(keys).forEach((code) => { keys[code] = false; });
  Object.keys(justPressed).forEach((code) => { justPressed[code] = false; });
  elements.unlockDialog.classList.add("hidden");
  elements.initialsDialog.classList.add("hidden");
  generateBuildings();
}

function startGame() {
  resetGameState();
  state = "playing";
  canvas.tabIndex = 0;
  frameClock.reset(performance.now());
  // Only show touch/control hints on first start after page load
  touchHintTimer = (isTouchDevice && isFirstStart) ? 180 : 0;

  elements.startScreen.classList.add("hidden");
  elements.gameOverScreen.classList.add("hidden");
  elements.pauseScreen.classList.add("hidden");

  // Show touch zone overlay briefly on mobile — only on first start
  if (isTouchDevice) {
    const pauseBtn = document.getElementById("pause-btn-mobile");
    pauseBtn.classList.remove("hidden");
    if (isFirstStart) {
      const touchControls = document.getElementById("touch-controls");
      touchControls.classList.remove("hidden");
      setTimeout(() => { touchControls.classList.add("hidden"); }, 3000);
    }
  }
  isFirstStart = false;
  feedback("start");
  canvas.focus({ preventScroll: true });
}

function pauseGame() {
  if (state !== "playing") return;
  previouslyFocusedElement = document.activeElement;
  state = "paused";
  document.getElementById("pause-score").textContent =
    "Score: " + Math.floor(score);
  elements.pauseScreen.classList.remove("hidden");
  requestAnimationFrame(() => elements.resumeButton.focus({ preventScroll: true }));
}

function resumeGame() {
  if (state !== "paused" || unlockPause || countdownTimer > 0) return;
  state = "playing";
  resumeGraceFrames = 10; // ~166ms collision immunity so obstacles near player don't instant-kill
  elements.pauseScreen.classList.add("hidden");
  restoreGameFocus();
}

function showUnlockTutorial(type, tutorial) {
  previouslyFocusedElement = document.activeElement;
  unlockPause = { type, ...tutorial };
  state = "paused";
  resumeGraceFrames = 15;
  elements.unlockDialog.style.setProperty("--dialog-color", tutorial.color);
  elements.unlockTitle.textContent = tutorial.title;
  elements.unlockDescription.replaceChildren(
    ...tutorial.lines.map((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      return paragraph;
    }),
  );
  elements.unlockDialog.classList.remove("hidden");
  feedback("unlock");
  requestAnimationFrame(() => elements.unlockConfirmButton.focus({ preventScroll: true }));
}

function dismissUnlockPause() {
  if (!unlockPause) return;
  markTutorialSeen(unlockPause.type);
  unlockPause = null;
  elements.unlockDialog.classList.add("hidden");
  // Start countdown instead of resuming immediately
  countdownTimer = COUNTDOWN_SECONDS * FRAMES_PER_SECOND;
  countdownNumber = COUNTDOWN_SECONDS;
  lastCountdownNumber = COUNTDOWN_SECONDS;
  playCue("countdown");
  restoreGameFocus();
  // Stay paused during countdown — state remains "paused"
}

function quitGame() {
  state = "start";
  canvas.tabIndex = -1;
  resetGameState();

  elements.pauseScreen.classList.add("hidden");
  elements.unlockDialog.classList.add("hidden");
  elements.initialsDialog.classList.add("hidden");
  elements.gameOverScreen.classList.add("hidden");
  elements.startScreen.classList.remove("hidden");
  document.getElementById("score-display").textContent = "SCORE 000000";
  if (isTouchDevice) {
    document.getElementById("pause-btn-mobile").classList.add("hidden");
  }
  renderLeaderboardHTML("start-leaderboard");
  elements.startButton.focus({ preventScroll: true });
}

elements.startButton.addEventListener("click", startGame);
elements.restartButton.addEventListener("click", startGame);
elements.resumeButton.addEventListener("click", resumeGame);
elements.quitButton.addEventListener("click", quitGame);
elements.unlockConfirmButton.addEventListener("click", dismissUnlockPause);
elements.initialsForm.addEventListener("submit", confirmInitials);
elements.initialsInput.addEventListener("input", () => {
  elements.initialsInput.value = normalizeInitials(elements.initialsInput.value);
  elements.initialsInput.setCustomValidity("");
});

elements.soundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  saveBooleanPreference("neonSprintSound", soundEnabled);
  updateFeedbackButtons();
  if (soundEnabled) playCue("start");
});

elements.hapticsToggle.addEventListener("click", () => {
  hapticsEnabled = !hapticsEnabled;
  saveBooleanPreference("neonSprintHaptics", hapticsEnabled);
  updateFeedbackButtons();
  if (hapticsEnabled) vibrateCue("jump");
});

// Mobile pause button
document.getElementById("pause-btn-mobile").addEventListener("click", (event) => {
  event.stopPropagation();
  if (state === "playing") {
    pauseGame();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "playing") pauseGame();
});

function showGameOverScreen() {
  document.getElementById("final-score").textContent = "Score: " + Math.floor(score);
  document.getElementById("high-score").textContent = "Best: " + Math.floor(highScore);
  document.getElementById("death-reason").textContent = deathReason;

  // Populate stats
  document.getElementById("stat-kills").textContent = droneKills;
  const speedPct = Math.floor(((maxSpeedReached - INITIAL_SPEED) / (MAX_SPEED - INITIAL_SPEED)) * 100);
  document.getElementById("stat-speed").textContent = speedPct + "%";
  const survived = Math.floor(activeRunTimeMs / 1000);
  document.getElementById("stat-time").textContent = survived + "s";

  renderLeaderboardHTML("game-over-leaderboard");
  elements.gameOverScreen.classList.remove("hidden");
  if (isTouchDevice) {
    document.getElementById("pause-btn-mobile").classList.add("hidden");
  }
  requestAnimationFrame(() => elements.restartButton.focus({ preventScroll: true }));
}

function gameOver(collisionType) {
  if (score > highScore) highScore = score;
  canvas.tabIndex = -1;
  deathReason = DEATH_MESSAGES[collisionType] || "Signal lost";
  screenShake = prefersReducedMotion ? 0 : 15; // ~250ms of screen shake
  deathFlash = 10; // brief red flash
  feedback("hit");

  // Neon explosion particles — more dramatic
  const particleCount = prefersReducedMotion ? 12 : 50;
  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 6;
    particles.push({
      x: player.x + player.width / 2,
      y: player.y + player.height / 2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      size: 2 + Math.random() * 3,
      color: ["#ff00ff", "#00ffcc", "#ff4444", "#ffaa00", "#00aaff"][
        Math.floor(Math.random() * 5)
      ],
    });
  }

  // Check if score qualifies for leaderboard
  if (isHighScore(Math.floor(score))) {
    state = "entering_initials";
    elements.initialsInput.value = "";
    elements.initialsDeathReason.textContent = deathReason;
    elements.initialsDialog.classList.remove("hidden");
    if (isTouchDevice) document.getElementById("pause-btn-mobile").classList.add("hidden");
    requestAnimationFrame(() => elements.initialsInput.focus({ preventScroll: true }));
  } else {
    state = "gameover";
    showGameOverScreen();
  }
}

// Obstacle types - city themed
function createObstacle() {
  const inAdvancedPhase = score >= ADVANCED_PHASE_SCORE;

  // In advanced phase, 25% chance of firewall (requires double jump)
  if (inAdvancedPhase && Math.random() < 0.25) {
    const h = 155 + Math.floor(Math.random() * 15); // 155-170px tall
    return { x: GAME_WIDTH, y: GROUND_Y - h, width: 28, height: h, type: "firewall" };
  }

  const type = Math.random();
  if (type < 0.3) {
    // Traffic barrier
    return { x: GAME_WIDTH, y: GROUND_Y - 35, width: 30, height: 35, type: "barrier" };
  } else if (type < 0.55) {
    // Hydrant / bollard
    return { x: GAME_WIDTH, y: GROUND_Y - 28, width: 18, height: 28, type: "bollard" };
  } else if (type < 0.8) {
    // Tall server rack / electric box
    return { x: GAME_WIDTH, y: GROUND_Y - 55, width: 24, height: 55, type: "server" };
  } else {
    // Drone - hovers up and down
    return {
      x: GAME_WIDTH,
      y: GROUND_Y - PLAYER_HEIGHT - 18,
      baseY: GROUND_Y - PLAYER_HEIGHT - 18,
      width: 40,
      height: 20,
      type: "drone",
      spawnTime: simulationTimeMs,
      hoverAmp: 18 + Math.random() * 14,   // 18-32px oscillation amplitude
      hoverSpeed: 1.5 + Math.random() * 1.5, // varied speed
    };
  }
}

// Returns the effective ground Y at a given x position (accounts for tunnel)
function getGroundAt(x) {
  if (!tunnel) return GROUND_Y;
  const t = tunnel;
  const entrEnd = t.x + t.entranceWidth;
  const bodyEnd = entrEnd + t.bodyWidth;
  const exitEnd = bodyEnd + t.exitWidth;

  if (x < t.x || x > exitEnd) return GROUND_Y;
  if (x < entrEnd) {
    // Entrance ramp: interpolate from GROUND_Y down to UNDERGROUND_Y
    const pct = (x - t.x) / t.entranceWidth;
    return GROUND_Y + (UNDERGROUND_Y - GROUND_Y) * pct;
  }
  if (x < bodyEnd) return UNDERGROUND_Y;
  // Exit ramp: interpolate from UNDERGROUND_Y back up to GROUND_Y
  const pct = (x - bodyEnd) / t.exitWidth;
  return UNDERGROUND_Y + (GROUND_Y - UNDERGROUND_Y) * pct;
}

function shootProjectile() {
  if (shootCooldown > 0) return;
  projectiles.push({
    x: player.x + player.width,
    y: player.y + player.height / 2 - BULLET_HEIGHT / 2,
    vx: BULLET_SPEED + gameSpeed,
    life: 1,
  });
  shootCooldown = SHOOT_COOLDOWN;
  feedback("shoot");
  // Muzzle flash particles
  for (let i = 0; i < 5; i++) {
    particles.push({
      x: player.x + player.width + 4,
      y: player.y + player.height / 2,
      vx: 2 + Math.random() * 4,
      vy: (Math.random() - 0.5) * 3,
      life: 0.3,
      size: 2 + Math.random() * 2,
      color: ["#00ffcc", "#ffaa00", "#ffffff"][Math.floor(Math.random() * 3)],
    });
  }
}

function updateProjectiles() {
  if (shootCooldown > 0) shootCooldown--;
  if (killFlashTimer > 0) killFlashTimer--;

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const b = projectiles[i];
    b.x += b.vx;
    b.life -= 0.008;

    // Check collision with drones
    let hitDrone = false;
    for (let j = obstacles.length - 1; j >= 0; j--) {
      const obs = obstacles[j];
      if (obs.type !== "drone") continue;
      if (b.x + BULLET_WIDTH > obs.x && b.x < obs.x + obs.width &&
          b.y + BULLET_HEIGHT > obs.y && b.y < obs.y + obs.height) {
        // Drone destroyed!
        droneKills++;
        score += DRONE_KILL_SCORE;
        killFlashTimer = 8;
        lastKillText = "+" + DRONE_KILL_SCORE;
        feedback("destroy");

        // Explosion particles
        for (let p = 0; p < 18; p++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 1.5 + Math.random() * 4;
          particles.push({
            x: obs.x + obs.width / 2,
            y: obs.y + obs.height / 2,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 0.7 + Math.random() * 0.3,
            size: 2 + Math.random() * 3,
            color: ["#ff4444", "#ff6600", "#ffaa00", "#ff0044", "#ffffff"][Math.floor(Math.random() * 5)],
          });
        }
        // Debris particles (darker, slower)
        for (let p = 0; p < 8; p++) {
          particles.push({
            x: obs.x + Math.random() * obs.width,
            y: obs.y + Math.random() * obs.height,
            vx: (Math.random() - 0.5) * 3,
            vy: 1 + Math.random() * 2,
            life: 0.5,
            size: 2 + Math.random() * 2,
            color: "#333344",
          });
        }

        obstacles.splice(j, 1);
        projectiles.splice(i, 1);
        hitDrone = true;
        break;
      }
    }

    // Remove if off-screen or expired (skip if already removed by drone hit)
    if (!hitDrone && i < projectiles.length && (projectiles[i].x > GAME_WIDTH + 20 || projectiles[i].life <= 0)) {
      projectiles.splice(i, 1);
    }
  }
}

function updatePlayer() {
  const jumpKey = justPressed["Space"] || justPressed["ArrowUp"] ||
    justPressed["KeyW"] || justPressed.PointerJump;
  const wantDuck = keys["ArrowDown"] || keys["KeyS"] || pointerInput.isHeld("slide");
  const wasDucking = player.ducking;

  // Check if double jump is unlocked
  player.canDoubleJump = score >= ADVANCED_PHASE_SCORE;
  const maxJumps = player.canDoubleJump ? 2 : 1;

  if (jumpKey && player.jumpsUsed < maxJumps) {
    const isDoubleJump = player.jumpsUsed === 1;
    player.vy = isDoubleJump ? DOUBLE_JUMP_FORCE : JUMP_FORCE;
    player.jumping = true;
    player.jumpsUsed++;
    feedback("jump");

    // Jump particles — different color for double jump
    const pColor = isDoubleJump ? "#ff00ff" : "#00ffcc";
    const currentGround = getGroundAt(player.x + player.width / 2);
    const pY = isDoubleJump ? player.y + player.height : currentGround;
    const count = isDoubleJump ? 10 : 6;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: player.x + player.width / 2 + (Math.random() - 0.5) * 20,
        y: pY,
        vx: (Math.random() - 0.5) * (isDoubleJump ? 5 : 3),
        vy: -Math.random() * (isDoubleJump ? 4 : 3),
        life: isDoubleJump ? 0.8 : 0.6,
        size: isDoubleJump ? 3 : 2,
        color: pColor,
      });
    }
  }

  // Clear justPressed flags
  justPressed["Space"] = false;
  justPressed["ArrowUp"] = false;
  justPressed["KeyW"] = false;
  justPressed.PointerJump = false;

  const groundHere = getGroundAt(player.x + player.width / 2);

  if (wantDuck && !player.jumping) {
    player.ducking = true;
    player.height = DUCK_HEIGHT;
    player.y = groundHere - DUCK_HEIGHT;
  } else {
    player.ducking = false;
    if (!player.jumping) {
      player.height = PLAYER_HEIGHT;
      player.y = groundHere - PLAYER_HEIGHT;
    }
  }
  if (player.ducking && !wasDucking) feedback("slide");

  player.vy += GRAVITY;
  player.y += player.vy;

  // Track jump key release — required before hover can activate
  const holdJump = keys["Space"] || keys["ArrowUp"] || keys["KeyW"] || pointerInput.isHeld("jump");

  if (player.jumping && !holdJump) {
    jumpKeyReleased = true;
  }

  if (!player.jumping) {
    jumpKeyReleased = false;
  }

  // Jetpack hover: must have jumped, released jump key, then re-held it
  if (jetpackUnlocked && player.jumping && holdJump && jumpKeyReleased && jetpackFuel > 0) {
    jetpackActive = true;
    player.vy *= 0.3;
    player.vy = Math.max(player.vy, -2);
    jetpackFuel -= JETPACK_BURN_RATE;
    if (jetpackFuel < 0) jetpackFuel = 0;
    // Flame particles from feet
    if (Math.random() < 0.7) {
      particles.push({
        x: player.x + player.width / 2 + (Math.random() - 0.5) * 12,
        y: player.y + player.height,
        vx: (Math.random() - 0.5) * 1.5,
        vy: 2 + Math.random() * 3,
        life: 0.5,
        size: 2 + Math.random() * 2,
        color: ["#ff6600", "#ffaa00", "#00ffcc"][Math.floor(Math.random() * 3)],
      });
    }
  } else {
    jetpackActive = false;
  }

  // Recharge jetpack on ground
  if (!player.jumping && jetpackUnlocked) {
    jetpackFuel = Math.min(JETPACK_MAX_FUEL, jetpackFuel + JETPACK_RECHARGE_RATE);
  }

  // Underground: ceiling check — prevent jumping above GROUND_Y when inside tunnel
  if (playerUnderground && player.y < GROUND_Y - player.height) {
    player.y = GROUND_Y - player.height;
    player.vy = 0;
  }

  // Ground landing
  if (player.y >= groundHere - player.height) {
    player.y = groundHere - player.height;
    player.vy = 0;
    player.jumping = false;
    player.jumpsUsed = 0;
  }

  // Track if player is underground
  const prevUnderground = playerUnderground;
  playerUnderground = player.y + player.height > GROUND_Y + 5;

  // Detect tunnel entry — spawn first obstacle quickly
  if (!prevUnderground && playerUnderground) {
    tunnelObstacleTimer = Math.max(35, tunnelObstacleTimer); // fast first spawn
  }

  // Detect tunnel exit transition — grant grace frames
  if (prevUnderground && !playerUnderground) {
    tunnelExitGrace = 60; // ~1 second of no obstacle spawns after surfacing
  }

  // Running trail
  player.trailTimer++;
  if (state === "playing" && player.trailTimer % 3 === 0) {
    particles.push({
      x: player.x,
      y: player.y + player.height - 4,
      vx: -gameSpeed * 0.3,
      vy: (Math.random() - 0.5) * 0.5,
      life: 0.4,
      size: 2 + Math.random() * 2,
      color: "#00ffcc44",
    });
  }
}

function updateTunnel() {
  if (!tunnel) {
    // Spawn check
    if (score >= TUNNEL_SCORE && Math.random() < 0.005) {
      tunnel = {
        x: GAME_WIDTH + 100,
        entranceWidth: 60,
        bodyWidth: 1400 + Math.random() * 600,
        exitWidth: 60,
      };
    }
    return;
  }

  tunnel.x -= gameSpeed;

  // Remove when fully off screen
  const totalWidth = tunnel.entranceWidth + tunnel.bodyWidth + tunnel.exitWidth;
  if (tunnel.x + totalWidth < -50) {
    tunnel = null;
    playerUnderground = false;
  }
}

// Create an underground-specific obstacle
function createUndergroundObstacle() {
  const type = Math.random();
  if (type < 0.18) {
    // Pipe at head height — duck under
    return {
      x: GAME_WIDTH,
      y: UNDERGROUND_Y - PLAYER_HEIGHT - 10,
      width: 40,
      height: 16,
      type: "pipe",
    };
  } else if (type < 0.32) {
    // Electrified puddle — small, jump over
    return {
      x: GAME_WIDTH,
      y: UNDERGROUND_Y - 12,
      width: 35,
      height: 12,
      type: "puddle_zap",
    };
  } else if (type < 0.46) {
    // Laser grid — horizontal beam across path, must duck under
    return {
      x: GAME_WIDTH,
      y: UNDERGROUND_Y - PLAYER_HEIGHT + 2,
      width: 60,
      height: 30,
      type: "laser_grid",
      spawnTime: simulationTimeMs,
    };
  } else if (type < 0.58) {
    // Steam vent — erupts from floor, must jump over
    return {
      x: GAME_WIDTH,
      y: UNDERGROUND_Y - 40,
      width: 20,
      height: 40,
      type: "steam_vent",
      spawnTime: simulationTimeMs,
    };
  } else if (type < 0.68) {
    // Hanging cables — dangle from ceiling, must duck
    return {
      x: GAME_WIDTH,
      y: GROUND_Y,
      width: 30,
      height: UNDERGROUND_Y - GROUND_Y - DUCK_HEIGHT + 2,
      type: "hanging_wire",
      spawnTime: simulationTimeMs,
    };
  } else if (type < 0.78) {
    // Barrel stack — medium height, must jump over
    return {
      x: GAME_WIDTH,
      y: UNDERGROUND_Y - 34,
      width: 28,
      height: 34,
      type: "barrel_stack",
    };
  } else if (type < 0.88) {
    // Ceiling crusher — piston slamming down, must time your run through
    return {
      x: GAME_WIDTH,
      y: GROUND_Y,
      width: 36,
      height: UNDERGROUND_Y - GROUND_Y - DUCK_HEIGHT + 5,
      type: "crusher",
      spawnTime: simulationTimeMs,
    };
  } else {
    // Toxic gas cloud — wide low cloud, must jump over
    return {
      x: GAME_WIDTH,
      y: UNDERGROUND_Y - 28,
      width: 55,
      height: 28,
      type: "toxic_cloud",
      spawnTime: simulationTimeMs,
    };
  }
}

// Create underground combo pairs — two obstacles that require quick reaction
function createUndergroundCombo() {
  const combo = Math.random();
  const pair = [];
  if (combo < 0.35) {
    // Floor obstacle then ceiling obstacle — jump then duck
    pair.push({
      x: GAME_WIDTH,
      y: UNDERGROUND_Y - 12,
      width: 35,
      height: 12,
      type: "puddle_zap",
    });
    pair.push({
      x: GAME_WIDTH + 200 + Math.random() * 60,
      y: GROUND_Y,
      width: 30,
      height: UNDERGROUND_Y - GROUND_Y - DUCK_HEIGHT + 2,
      type: "hanging_wire",
      spawnTime: simulationTimeMs,
    });
  } else if (combo < 0.7) {
    // Ceiling obstacle then floor obstacle — duck then jump
    pair.push({
      x: GAME_WIDTH,
      y: UNDERGROUND_Y - PLAYER_HEIGHT + 2,
      width: 60,
      height: 30,
      type: "laser_grid",
      spawnTime: simulationTimeMs,
    });
    pair.push({
      x: GAME_WIDTH + 220 + Math.random() * 60,
      y: UNDERGROUND_Y - 40,
      width: 20,
      height: 40,
      type: "steam_vent",
      spawnTime: simulationTimeMs,
    });
  } else {
    // Double floor hazard — two jumps in quick succession
    pair.push({
      x: GAME_WIDTH,
      y: UNDERGROUND_Y - 34,
      width: 28,
      height: 34,
      type: "barrel_stack",
    });
    pair.push({
      x: GAME_WIDTH + 200 + Math.random() * 60,
      y: UNDERGROUND_Y - 28,
      width: 55,
      height: 28,
      type: "toxic_cloud",
      spawnTime: simulationTimeMs,
    });
  }
  return pair;
}

function updateObstacles() {
  frameCount++;
  if (tunnelExitGrace > 0) tunnelExitGrace--;
  const minGap = Math.max(55, 100 - gameSpeed * 3);

  if (playerUnderground) {
    // Underground obstacle spawning — tighter gaps than surface
    tunnelObstacleTimer++;
    const ugGap = Math.max(50, minGap); // give player enough time to land and react
    if (tunnelObstacleTimer > ugGap) {
      // 25% chance of combo obstacles (two in quick succession)
      if (Math.random() < 0.25) {
        const combo = createUndergroundCombo();
        for (const obs of combo) obstacles.push(obs);
      } else {
        obstacles.push(createUndergroundObstacle());
      }
      tunnelObstacleTimer = 0;
    }
  } else if (
    tunnelExitGrace <= 0 &&
    frameCount > minGap &&
    (function() {
      if (obstacles.length === 0) return true;
      const rightmost = Math.max(...obstacles.map(o => o.x + o.width));
      return rightmost < GAME_WIDTH - 200 - Math.random() * 150;
    })()
  ) {
    // Normal surface obstacle spawning (skip if tunnel entrance is on screen)
    const tunnelOnScreen = tunnel && tunnel.x < GAME_WIDTH && tunnel.x > -100;
    if (!tunnelOnScreen) {
      // Combo obstacles: ground + drone pair at high scores (20% chance)
      if (score >= COMBO_OBSTACLE_SCORE && Math.random() < 0.2) {
        obstacles.push({ x: GAME_WIDTH, y: GROUND_Y - 35, width: 30, height: 35, type: "barrier" });
        obstacles.push({
          x: GAME_WIDTH + 120,
          y: GROUND_Y - PLAYER_HEIGHT - 18,
          baseY: GROUND_Y - PLAYER_HEIGHT - 18,
          width: 40,
          height: 20,
          type: "drone",
          spawnTime: simulationTimeMs,
          hoverAmp: 18 + Math.random() * 14,
          hoverSpeed: 1.5 + Math.random() * 1.5,
        });
      } else {
        obstacles.push(createObstacle());
      }
    }
    frameCount = 0;
  }

  for (let i = obstacles.length - 1; i >= 0; i--) {
    const obs = obstacles[i];
    const speedMult = (obs.type === "drone" && score >= FAST_DRONE_SCORE) ? 1.4 : 1;
    obs.x -= gameSpeed * speedMult;

    // Drone vertical hover oscillation
    if (obs.type === "drone" && obs.baseY !== undefined) {
      const elapsed = (simulationTimeMs - obs.spawnTime) / 1000;
      obs.y = obs.baseY + Math.sin(elapsed * obs.hoverSpeed) * obs.hoverAmp;
    }

    if (obs.x + obs.width < 0) {
      obstacles.splice(i, 1);
    }
  }
}

function checkCollisions() {
  if (resumeGraceFrames > 0) { resumeGraceFrames--; return; }
  const px = player.x + 5;
  const py = player.y + 5;
  const pw = player.width - 10;
  const ph = player.height - 10;

  for (const obs of obstacles) {
    // Skip surface obstacles when player is underground, and vice versa
    const isUndergroundObs = obs.type === "pipe" || obs.type === "puddle_zap" ||
      obs.type === "laser_grid" || obs.type === "steam_vent" || obs.type === "hanging_wire" ||
      obs.type === "barrel_stack" || obs.type === "crusher" || obs.type === "toxic_cloud";
    if (playerUnderground && !isUndergroundObs) continue;
    if (!playerUnderground && isUndergroundObs) continue;
    // Grace period after surfacing — skip surface obstacles near the exit
    if (tunnelExitGrace > 0 && !isUndergroundObs) continue;

    const playerHitbox = { x: px, y: py, width: pw, height: ph };
    const obstacleHitbox = {
      x: obs.x + 3,
      y: obs.y + 3,
      width: obs.width - 6,
      height: obs.height - 6,
    };
    if (rectanglesOverlap(playerHitbox, obstacleHitbox)) {
      gameOver(obs.type);
      return;
    }
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 0.025;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// ---------- DRAWING ----------

function drawSky() {
  const period = getCurrentTimePeriod();
  const grad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  grad.addColorStop(0, period.sky[0]);
  grad.addColorStop(0.5, period.sky[1]);
  grad.addColorStop(1, period.sky[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, GAME_WIDTH, GROUND_Y);

  // Atmospheric haze overlay
  if (period.haze) {
    ctx.fillStyle = period.haze;
    ctx.fillRect(0, 0, GAME_WIDTH, GROUND_Y);
  }

  // Lightning flash overlay (for STORM period)
  if (lightningFlash > 0) {
    ctx.fillStyle = `rgba(200, 200, 255, ${lightningFlash * 0.3})`;
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  }
}

function drawStars() {
  const period = getCurrentTimePeriod();
  if (period.starAlpha < 0.03) return; // no stars in heavy weather
  const starSeed = [
    [50, 20], [150, 40], [250, 15], [370, 35], [480, 25],
    [560, 50], [650, 18], [720, 42], [100, 55], [310, 48],
    [430, 10], [590, 30], [680, 52], [770, 28], [200, 32],
    [40, 60], [500, 8], [620, 55], [340, 22], [750, 12],
  ];
  const starOffset = (groundOffset * 0.02) % GAME_WIDTH;
  for (const [sx, sy] of starSeed) {
    const px = ((sx - starOffset) % GAME_WIDTH + GAME_WIDTH) % GAME_WIDTH;
    const flicker = 0.3 + Math.sin(visualTimeMs() / 800 + sx * 0.5) * 0.25;
    ctx.globalAlpha = flicker * period.starAlpha;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(px, sy, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
}

function drawMoon() {
  const period = getCurrentTimePeriod();
  if (period.moonAlpha < 0.03) return; // hidden during storms/rain
  ctx.save();
  ctx.globalAlpha = period.moonAlpha;
  ctx.fillStyle = "#ff88cc";
  ctx.beginPath();
  ctx.arc(680, 50, 25, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = period.moonAlpha * 0.5;
  ctx.fillStyle = "#ff00ff";
  ctx.beginPath();
  ctx.arc(680, 50, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function updateWeather() {
  const period = getCurrentTimePeriod();

  if (prefersReducedMotion) {
    weatherParticles = [];
    lightningFlash = 0;
    return;
  }

  if (lightningFlash > 0) {
    lightningFlash *= 0.85;
    if (lightningFlash < 0.01) lightningFlash = 0;
  }

  // === Acid Rain ===
  if (period.name === "ACID RAIN") {
    // Spawn rain drops
    if (weatherParticles.length < 80) {
      for (let i = 0; i < 3; i++) {
        weatherParticles.push({
          type: "rain",
          x: Math.random() * (GAME_WIDTH + 100) - 50,
          y: -10 - Math.random() * 40,
          vx: -1.5 - Math.random(),
          vy: 6 + Math.random() * 4,
          len: 8 + Math.random() * 6,
          life: 1,
        });
      }
    }
  }

  // === Neon Fog ===
  if (period.name === "NEON FOG") {
    if (weatherParticles.length < 25) {
      weatherParticles.push({
        type: "fog",
        x: GAME_WIDTH + Math.random() * 100,
        y: 50 + Math.random() * (GROUND_Y - 80),
        radius: 30 + Math.random() * 50,
        vx: -0.5 - Math.random() * 0.8,
        alpha: 0.03 + Math.random() * 0.04,
        hue: Math.random() > 0.5 ? 280 : 300,
        life: 1,
      });
    }
  }

  // === Storm (lightning + heavy rain) ===
  if (period.name === "STORM") {
    // Heavy rain
    if (weatherParticles.length < 120) {
      for (let i = 0; i < 5; i++) {
        weatherParticles.push({
          type: "rain",
          x: Math.random() * (GAME_WIDTH + 100) - 50,
          y: -10 - Math.random() * 40,
          vx: -2 - Math.random() * 2,
          vy: 8 + Math.random() * 5,
          len: 10 + Math.random() * 8,
          life: 1,
        });
      }
    }
    // Lightning
    lightningTimer--;
    if (lightningTimer <= 0) {
      lightningFlash = 0.6 + Math.random() * 0.4;
      lightningTimer = 120 + Math.random() * 300; // every 2-7 seconds
    }
  }

  // Update and cull particles
  for (let i = weatherParticles.length - 1; i >= 0; i--) {
    const p = weatherParticles[i];
    p.x += p.vx || 0;
    p.y += (p.vy || 0);
    if (p.type === "rain" && p.y > GROUND_Y) {
      weatherParticles.splice(i, 1);
    } else if (p.type === "fog" && p.x + p.radius < -50) {
      weatherParticles.splice(i, 1);
    }
  }

  // Clean up particles when weather changes
  if (period.name !== "ACID RAIN" && period.name !== "STORM") {
    weatherParticles = weatherParticles.filter(p => p.type !== "rain");
  }
  if (period.name !== "NEON FOG") {
    weatherParticles = weatherParticles.filter(p => p.type !== "fog");
  }
}

function drawWeather() {
  const period = getCurrentTimePeriod();
  ctx.save();

  for (const p of weatherParticles) {
    if (p.type === "rain") {
      // Acid rain = green tint, storm rain = blue-white
      if (period.name === "ACID RAIN") {
        ctx.strokeStyle = "rgba(0, 255, 100, 0.35)";
      } else {
        ctx.strokeStyle = "rgba(150, 170, 220, 0.3)";
      }
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.vx * 0.5, p.y + p.len);
      ctx.stroke();
    } else if (p.type === "fog") {
      ctx.fillStyle = `hsla(${p.hue}, 60%, 50%, ${p.alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Storm: draw lightning bolt on flash
  if (period.name === "STORM" && lightningFlash > 0.3) {
    ctx.save();
    ctx.strokeStyle = `rgba(200, 200, 255, ${lightningFlash * 0.7})`;
    ctx.lineWidth = 2;
    ctx.shadowColor = "#aaaaff";
    ctx.shadowBlur = 15;
    const boltX = 100 + Math.random() * (GAME_WIDTH - 200);
    let bx = boltX, by = 0;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    while (by < GROUND_Y - 20) {
      bx += (Math.random() - 0.5) * 30;
      by += 15 + Math.random() * 25;
      ctx.lineTo(bx, Math.min(by, GROUND_Y - 10));
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  ctx.restore();
}

function drawCityLayer(layer, speed, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const offset = (groundOffset * speed) % (GAME_WIDTH + 400);

  for (const b of layer) {
    const bx = ((b.x - offset) % (GAME_WIDTH + 400) + GAME_WIDTH + 400) % (GAME_WIDTH + 400) - 200;
    const by = GROUND_Y - b.h;

    // Building body
    ctx.fillStyle = b.color;
    ctx.fillRect(bx, by, b.w, b.h);

    // Roof line glow
    ctx.fillStyle = b.glowColor || "#ff00ff";
    ctx.globalAlpha = alpha * 0.3;
    ctx.fillRect(bx, by, b.w, 2);
    ctx.globalAlpha = alpha;

    // Windows (pre-baked colors from generateBuildings)
    if (b.windows && b.windowColors) {
      for (const win of b.windowColors) {
        const wx = bx + 4 + win.c * 10;
        const wy = by + 6 + win.r * 14;
        ctx.fillStyle = win.color;
        ctx.fillRect(wx, wy, 3, 4);
      }
    }

    // Antenna
    if (b.antenna) {
      ctx.strokeStyle = "#333344";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx + b.w / 2, by);
      ctx.lineTo(bx + b.w / 2, by - 15);
      ctx.stroke();
      // Blinking red light
      const blink = Math.sin(visualTimeMs() / 500 + bx) > 0;
      if (blink) {
        ctx.fillStyle = "#ff0000";
        ctx.globalAlpha = alpha * 0.8;
        ctx.fillRect(bx + b.w / 2 - 1.5, by - 17, 3, 3);
        ctx.globalAlpha = alpha;
      }
    }
  }
  ctx.restore();
}

function drawGround() {
  // Road surface
  ctx.fillStyle = "#151525";
  ctx.fillRect(0, GROUND_Y, GAME_WIDTH, GAME_HEIGHT - GROUND_Y);

  // Neon road line (break at tunnel entrance/exit)
  const t = visualTimeMs() / 1000;
  const period = getCurrentTimePeriod();
  ctx.strokeStyle = period.roadGlow;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.6 + Math.sin(t * 3) * 0.2;
  if (tunnel) {
    const tEnd = tunnel.x + tunnel.entranceWidth + tunnel.bodyWidth + tunnel.exitWidth;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(Math.max(0, tunnel.x), GROUND_Y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(Math.min(GAME_WIDTH, tEnd), GROUND_Y);
    ctx.lineTo(GAME_WIDTH, GROUND_Y);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(GAME_WIDTH, GROUND_Y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Glow under the road line (match current time-of-day road color)
  const rgHex = period.roadGlow;
  const rgR = parseInt(rgHex.slice(1,3), 16), rgG = parseInt(rgHex.slice(3,5), 16), rgB = parseInt(rgHex.slice(5,7), 16);
  const roadGlowGrad = ctx.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 8);
  roadGlowGrad.addColorStop(0, `rgba(${rgR}, ${rgG}, ${rgB}, 0.2)`);
  roadGlowGrad.addColorStop(1, `rgba(${rgR}, ${rgG}, ${rgB}, 0)`);
  ctx.fillStyle = roadGlowGrad;
  ctx.fillRect(0, GROUND_Y, GAME_WIDTH, 8);

  // Dashed center line
  ctx.strokeStyle = "#333355";
  ctx.lineWidth = 1;
  const dashLen = 30;
  const gapLen = 20;
  const totalDash = dashLen + gapLen;
  const off = groundOffset % totalDash;
  for (let x = -off; x < GAME_WIDTH; x += totalDash) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y + 25);
    ctx.lineTo(x + dashLen, GROUND_Y + 25);
    ctx.stroke();
  }

  // Curb glow
  ctx.strokeStyle = "#00ffcc";
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y + GAME_HEIGHT - GROUND_Y);
  ctx.lineTo(GAME_WIDTH, GROUND_Y + GAME_HEIGHT - GROUND_Y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  ctx.save();
  const px = player.x;
  const py = player.y;
  const t = visualTimeMs();

  // Glow effect under player
  const playerGround = getGroundAt(px + player.width / 2);
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = "#00ffcc";
  ctx.fillRect(px - 5, playerGround - 2, player.width + 10, 4);
  ctx.globalAlpha = 1;

  if (player.ducking) {
    // Sliding body
    ctx.fillStyle = "#111122";
    ctx.fillRect(px, py + 2, player.width + 6, player.height - 2);
    ctx.fillStyle = "#00ffcc";
    ctx.fillRect(px + 1, py + 3, player.width + 4, player.height - 4);

    // Visor
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(px + player.width, py + 4, 8, 6);
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.8;
    ctx.fillRect(px + player.width + 2, py + 5, 4, 3);
    ctx.globalAlpha = 1;
  } else {
    // Body (cyber suit)
    ctx.fillStyle = "#111122";
    ctx.fillRect(px + 4, py + 8, player.width - 8, player.height - 18);
    ctx.fillStyle = "#00ccaa";
    ctx.fillRect(px + 5, py + 9, player.width - 10, player.height - 20);

    // Neon trim lines
    ctx.strokeStyle = "#00ffcc";
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.strokeRect(px + 5, py + 9, player.width - 10, player.height - 20);
    ctx.globalAlpha = 1;

    // Chest detail
    ctx.fillStyle = "#008877";
    ctx.fillRect(px + 10, py + 16, player.width - 20, 3);
    ctx.fillRect(px + 12, py + 22, player.width - 24, 2);

    // Head (helmet)
    ctx.fillStyle = "#0d0d1a";
    ctx.fillRect(px + 6, py - 2, player.width - 12, 14);
    ctx.fillStyle = "#1a1a30";
    ctx.fillRect(px + 7, py - 1, player.width - 14, 12);

    // Visor (glowing)
    const visorGlow = 0.7 + Math.sin(t / 200) * 0.3;
    ctx.fillStyle = "#ff00ff";
    ctx.globalAlpha = visorGlow;
    ctx.fillRect(px + player.width - 14, py + 1, 12, 6);
    ctx.fillStyle = "#ff88cc";
    ctx.globalAlpha = visorGlow * 0.6;
    ctx.fillRect(px + player.width - 12, py + 2, 8, 4);
    ctx.globalAlpha = 1;

    // Legs (animated)
    ctx.fillStyle = "#00aa88";
    const legAnim = Math.sin(t / 80) * 5;
    const legL = player.jumping ? 0 : legAnim;
    const legR = player.jumping ? 0 : -legAnim;
    ctx.fillRect(px + 8, py + player.height - 12 + legL, 7, 12 - legL);
    ctx.fillRect(px + player.width - 15, py + player.height - 12 + legR, 7, 12 - legR);

    // Shoe glow
    ctx.fillStyle = "#00ffcc";
    ctx.globalAlpha = 0.6;
    ctx.fillRect(px + 7, py + player.height - 2, 9, 2);
    ctx.fillRect(px + player.width - 16, py + player.height - 2, 9, 2);
    ctx.globalAlpha = 1;

    // Arm
    ctx.fillStyle = "#00aa88";
    const armY = player.jumping ? -4 : Math.sin(t / 100) * 3;
    ctx.fillRect(px + player.width - 4, py + 18 + armY, 7, 5);
  }

  ctx.restore();
}

function drawObstacle(obs) {
  ctx.save();
  const t = visualTimeMs();

  if (obs.type === "barrier") {
    // Traffic barrier with warning stripes
    ctx.fillStyle = "#2a2a3a";
    ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
    // Warning stripes
    ctx.fillStyle = "#ff6600";
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(obs.x + 2, obs.y + 4 + i * 11, obs.width - 4, 5);
    }
    // Reflective top
    ctx.fillStyle = "#ff4400";
    ctx.globalAlpha = 0.5 + Math.sin(t / 300) * 0.3;
    ctx.fillRect(obs.x, obs.y, obs.width, 3);
    ctx.globalAlpha = 1;
    // Posts
    ctx.fillStyle = "#444455";
    ctx.fillRect(obs.x + 2, obs.y + obs.height - 6, 4, 6);
    ctx.fillRect(obs.x + obs.width - 6, obs.y + obs.height - 6, 4, 6);
  } else if (obs.type === "bollard") {
    // Neon bollard / fire hydrant
    ctx.fillStyle = "#cc2200";
    ctx.fillRect(obs.x + 3, obs.y + 6, obs.width - 6, obs.height - 6);
    ctx.fillStyle = "#ff3300";
    ctx.fillRect(obs.x + 2, obs.y + 4, obs.width - 4, 8);
    // Top cap
    ctx.fillStyle = "#dd4400";
    ctx.fillRect(obs.x + 1, obs.y, obs.width - 2, 6);
    // Glow ring
    ctx.strokeStyle = "#ff6600";
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5 + Math.sin(t / 400 + obs.x) * 0.3;
    ctx.strokeRect(obs.x + 1, obs.y + 12, obs.width - 2, 4);
    ctx.globalAlpha = 1;
  } else if (obs.type === "server") {
    // Tall electric box / server rack
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
    ctx.strokeStyle = "#333355";
    ctx.lineWidth = 1;
    ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);
    // Server lights
    for (let i = 0; i < 6; i++) {
      const litColor = Math.sin(t / 300 + i * 2 + obs.x) > 0 ? "#00ff88" : "#003322";
      ctx.fillStyle = litColor;
      ctx.fillRect(obs.x + 4, obs.y + 6 + i * 8, 3, 3);
      ctx.fillStyle = "#222233";
      ctx.fillRect(obs.x + 10, obs.y + 5 + i * 8, obs.width - 14, 5);
    }
    // Hazard stripe at top
    ctx.fillStyle = "#ffcc00";
    ctx.globalAlpha = 0.6;
    ctx.fillRect(obs.x, obs.y, obs.width, 3);
    ctx.globalAlpha = 1;
  } else if (obs.type === "firewall") {
    // Tall energy firewall - requires double jump
    const pulse = Math.sin(t / 150 + obs.x * 0.1);

    // Base structure (dark pillars on sides)
    ctx.fillStyle = "#1a0a2e";
    ctx.fillRect(obs.x, obs.y, 4, obs.height);
    ctx.fillRect(obs.x + obs.width - 4, obs.y, 4, obs.height);

    // Energy field (animated vertical bars)
    for (let row = 0; row < obs.height; row += 4) {
      const wave = Math.sin(t / 200 + row * 0.15) * 0.4;
      const intensity = 0.4 + wave + pulse * 0.2;
      ctx.globalAlpha = Math.max(0.1, Math.min(1, intensity));
      const hue = (row * 2 + t / 10) % 60;
      ctx.fillStyle = `hsl(${280 + hue}, 100%, ${50 + wave * 20}%)`;
      ctx.fillRect(obs.x + 4, obs.y + row, obs.width - 8, 3);
    }
    ctx.globalAlpha = 1;

    // Bright edge glow
    ctx.fillStyle = "#ff00ff";
    ctx.globalAlpha = 0.5 + pulse * 0.3;
    ctx.fillRect(obs.x + 3, obs.y, 2, obs.height);
    ctx.fillRect(obs.x + obs.width - 5, obs.y, 2, obs.height);
    ctx.globalAlpha = 1;

    // Top hazard cap
    ctx.fillStyle = "#ff00ff";
    ctx.globalAlpha = 0.7 + pulse * 0.3;
    ctx.fillRect(obs.x - 2, obs.y - 2, obs.width + 4, 4);
    ctx.globalAlpha = 1;

    // Ambient glow
    ctx.globalAlpha = 0.06 + pulse * 0.03;
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(obs.x - 8, obs.y, obs.width + 16, obs.height);
    ctx.globalAlpha = 1;

  } else if (obs.type === "drone") {
    // Drone body
    ctx.fillStyle = "#333344";
    ctx.fillRect(obs.x + 10, obs.y + 6, obs.width - 20, obs.height - 10);
    ctx.fillStyle = "#444455";
    ctx.fillRect(obs.x + 8, obs.y + 8, obs.width - 16, obs.height - 14);

    // Rotors (animated)
    const rotorPhase = Math.sin(t / 50) * 4;
    ctx.fillStyle = "#666688";
    ctx.globalAlpha = 0.7;
    ctx.fillRect(obs.x - 2, obs.y + 2 + rotorPhase * 0.3, 14, 3);
    ctx.fillRect(obs.x + obs.width - 12, obs.y + 2 - rotorPhase * 0.3, 14, 3);
    ctx.globalAlpha = 1;

    // Eye / sensor
    ctx.fillStyle = "#ff0044";
    ctx.globalAlpha = 0.7 + Math.sin(t / 200) * 0.3;
    ctx.fillRect(obs.x + obs.width / 2 - 3, obs.y + obs.height / 2 - 2, 6, 4);
    ctx.globalAlpha = 1;

    // Bottom light
    ctx.fillStyle = "#ff0044";
    ctx.globalAlpha = 0.2;
    ctx.fillRect(obs.x + obs.width / 2 - 1, obs.y + obs.height - 2, 2, 10);
    ctx.globalAlpha = 1;

    // Hover glow
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = "#ff0044";
    ctx.fillRect(obs.x + 5, obs.y - 4, obs.width - 10, obs.height + 8);
    ctx.globalAlpha = 1;

    // Target reticle — pulsing circle around drone
    const reticleAlpha = 0.2 + Math.sin(t / 150) * 0.15;
    ctx.strokeStyle = "#ff0044";
    ctx.lineWidth = 1;
    ctx.globalAlpha = reticleAlpha;
    const cx = obs.x + obs.width / 2;
    const cy = obs.y + obs.height / 2;
    const rr = 18 + Math.sin(t / 200) * 3;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
    // Crosshair ticks
    ctx.beginPath();
    ctx.moveTo(cx - rr - 3, cy); ctx.lineTo(cx - rr + 4, cy);
    ctx.moveTo(cx + rr - 4, cy); ctx.lineTo(cx + rr + 3, cy);
    ctx.moveTo(cx, cy - rr - 3); ctx.lineTo(cx, cy - rr + 4);
    ctx.moveTo(cx, cy + rr - 4); ctx.lineTo(cx, cy + rr + 3);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (obs.type === "pipe") {
    // Underground pipe — horizontal, industrial
    ctx.fillStyle = "#2a3a2a";
    ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
    ctx.fillStyle = "#3a5a3a";
    ctx.fillRect(obs.x + 2, obs.y + 2, obs.width - 4, obs.height - 4);
    // Rust streaks
    ctx.fillStyle = "#664422";
    ctx.globalAlpha = 0.4;
    ctx.fillRect(obs.x + 8, obs.y + obs.height - 3, 12, 3);
    ctx.globalAlpha = 1;
    // Neon band
    ctx.fillStyle = "#00ff66";
    ctx.globalAlpha = 0.5 + Math.sin(t / 300 + obs.x) * 0.3;
    ctx.fillRect(obs.x, obs.y + obs.height / 2 - 1, obs.width, 2);
    ctx.globalAlpha = 1;
  } else if (obs.type === "puddle_zap") {
    // Electrified puddle on the ground
    const zap = Math.sin(t / 100 + obs.x * 0.3);
    ctx.fillStyle = "#002211";
    ctx.globalAlpha = 0.6;
    ctx.fillRect(obs.x, obs.y + obs.height - 4, obs.width, 4);
    ctx.globalAlpha = 1;
    // Electric arcs
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6 + zap * 0.4;
    for (let i = 0; i < 3; i++) {
      const arcX = obs.x + 5 + i * 10;
      const arcH = 4 + Math.sin(t / 80 + i * 2) * 3;
      ctx.beginPath();
      ctx.moveTo(arcX, obs.y + obs.height - 4);
      ctx.lineTo(arcX + 3, obs.y + obs.height - 4 - arcH);
      ctx.lineTo(arcX + 6, obs.y + obs.height - 4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Green glow
    ctx.fillStyle = "#00ff88";
    ctx.globalAlpha = 0.08 + zap * 0.04;
    ctx.fillRect(obs.x - 4, obs.y - 8, obs.width + 8, obs.height + 12);
    ctx.globalAlpha = 1;
  } else if (obs.type === "laser_grid") {
    // Horizontal laser beams — red scanning lines
    const elapsed = (t - obs.spawnTime) / 1000;
    const flicker = Math.sin(elapsed * 8) * 0.3;
    ctx.strokeStyle = "#ff0033";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.7 + flicker;
    // Draw 3 horizontal beams
    for (let i = 0; i < 3; i++) {
      const by = obs.y + 5 + i * 10;
      ctx.beginPath();
      ctx.moveTo(obs.x, by);
      ctx.lineTo(obs.x + obs.width, by);
      ctx.stroke();
    }
    // Emitter boxes on sides
    ctx.fillStyle = "#440011";
    ctx.globalAlpha = 1;
    ctx.fillRect(obs.x - 3, obs.y, 6, obs.height);
    ctx.fillRect(obs.x + obs.width - 3, obs.y, 6, obs.height);
    // Red glow
    ctx.fillStyle = "#ff0033";
    ctx.globalAlpha = 0.06 + flicker * 0.04;
    ctx.fillRect(obs.x - 4, obs.y - 6, obs.width + 8, obs.height + 12);
    ctx.globalAlpha = 1;
  } else if (obs.type === "steam_vent") {
    // Floor vent erupting steam upward
    const elapsed = (t - obs.spawnTime) / 1000;
    // Vent base (metal grate)
    ctx.fillStyle = "#3a3a4a";
    ctx.fillRect(obs.x, obs.y + obs.height - 6, obs.width, 6);
    ctx.fillStyle = "#555566";
    for (let gx = obs.x + 3; gx < obs.x + obs.width - 3; gx += 5) {
      ctx.fillRect(gx, obs.y + obs.height - 5, 2, 4);
    }
    // Steam column
    ctx.fillStyle = "#aabbcc";
    for (let sy = 0; sy < obs.height - 6; sy += 4) {
      const wobble = Math.sin(elapsed * 6 + sy * 0.3) * 3;
      const fade = 1 - sy / (obs.height - 6);
      ctx.globalAlpha = fade * 0.4;
      ctx.fillRect(obs.x + wobble + 2, obs.y + sy, obs.width - 4, 3);
    }
    ctx.globalAlpha = 1;
    // Hot glow at base
    ctx.fillStyle = "#ff6600";
    ctx.globalAlpha = 0.2 + Math.sin(elapsed * 5) * 0.1;
    ctx.fillRect(obs.x - 2, obs.y + obs.height - 8, obs.width + 4, 8);
    ctx.globalAlpha = 1;
  } else if (obs.type === "hanging_wire") {
    // Cables dangling from tunnel ceiling
    const elapsed = (t - obs.spawnTime) / 1000;
    const sway = Math.sin(elapsed * 2) * 3;
    // Mount point on ceiling
    ctx.fillStyle = "#444455";
    ctx.fillRect(obs.x + 8, obs.y, 14, 5);
    // Wires
    ctx.strokeStyle = "#666688";
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const wx = obs.x + 8 + i * 6;
      const wireLen = obs.height - 5 + (i === 1 ? 4 : 0);
      ctx.beginPath();
      ctx.moveTo(wx, obs.y + 5);
      ctx.quadraticCurveTo(wx + sway * (i === 1 ? 1.5 : 1), obs.y + wireLen * 0.5, wx + sway, obs.y + wireLen);
      ctx.stroke();
    }
    // Spark at bottom
    const sparkOn = Math.sin(elapsed * 12 + obs.x) > 0.6;
    if (sparkOn) {
      ctx.fillStyle = "#00ffff";
      ctx.globalAlpha = 0.8;
      ctx.fillRect(obs.x + 12 + sway - 2, obs.y + obs.height - 4, 4, 4);
      ctx.globalAlpha = 1;
    }
  } else if (obs.type === "barrel_stack") {
    // Stacked industrial barrels — jump over
    const barrelW = 14;
    const barrelH = 16;
    // Bottom barrel
    ctx.fillStyle = "#3a2a1a";
    ctx.fillRect(obs.x + 2, obs.y + barrelH, barrelW * 2 - 4, barrelH);
    ctx.fillStyle = "#4a3a2a";
    ctx.fillRect(obs.x + 4, obs.y + barrelH + 2, barrelW * 2 - 8, barrelH - 4);
    // Top barrel
    ctx.fillStyle = "#3a2a1a";
    ctx.fillRect(obs.x + 5, obs.y, barrelW, barrelH);
    ctx.fillStyle = "#4a3a2a";
    ctx.fillRect(obs.x + 7, obs.y + 2, barrelW - 4, barrelH - 4);
    // Hazard stripe
    ctx.fillStyle = "#ff6600";
    ctx.globalAlpha = 0.5;
    ctx.fillRect(obs.x + 6, obs.y + 6, barrelW - 2, 3);
    ctx.fillRect(obs.x + 3, obs.y + barrelH + 6, barrelW * 2 - 6, 3);
    ctx.globalAlpha = 1;
    // Toxic drip
    const dripPhase = (t + obs.x * 0.5) % 800;
    if (dripPhase < 400) {
      ctx.fillStyle = "#00ff66";
      ctx.globalAlpha = 0.5;
      ctx.fillRect(obs.x + 12, obs.y + obs.height + (dripPhase / 400) * 6, 2, 3);
      ctx.globalAlpha = 1;
    }
  } else if (obs.type === "crusher") {
    // Ceiling piston slamming down — duck under
    const elapsed = (t - obs.spawnTime) / 1000;
    const crushCycle = Math.abs(Math.sin(elapsed * 2.5));
    const pistonY = obs.y;
    const pistonH = obs.height * (0.6 + crushCycle * 0.4);
    // Piston housing on ceiling
    ctx.fillStyle = "#2a2a3e";
    ctx.fillRect(obs.x - 2, pistonY, obs.width + 4, 10);
    // Piston shaft
    ctx.fillStyle = "#444466";
    ctx.fillRect(obs.x + 4, pistonY + 10, obs.width - 8, pistonH - 16);
    // Piston head
    ctx.fillStyle = "#555577";
    ctx.fillRect(obs.x, pistonY + pistonH - 8, obs.width, 8);
    // Impact sparks when near full extension
    if (crushCycle > 0.85) {
      ctx.fillStyle = "#ffaa00";
      ctx.globalAlpha = (crushCycle - 0.85) * 6;
      for (let sp = 0; sp < 3; sp++) {
        const sx = obs.x + Math.random() * obs.width;
        ctx.fillRect(sx, pistonY + pistonH - 2, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    // Warning stripe on head
    ctx.fillStyle = "#ff0033";
    ctx.globalAlpha = 0.4 + Math.sin(elapsed * 8) * 0.2;
    ctx.fillRect(obs.x + 2, pistonY + pistonH - 6, obs.width - 4, 2);
    ctx.globalAlpha = 1;
  } else if (obs.type === "toxic_cloud") {
    // Low-lying toxic gas cloud — jump over
    const elapsed = (t - obs.spawnTime) / 1000;
    // Cloud puffs
    for (let ci = 0; ci < 5; ci++) {
      const cx = obs.x + ci * 11 + Math.sin(elapsed * 1.5 + ci * 1.2) * 3;
      const cy = obs.y + 6 + Math.sin(elapsed * 2 + ci * 0.8) * 4;
      const cr = 8 + Math.sin(elapsed + ci) * 2;
      ctx.fillStyle = "#00ff44";
      ctx.globalAlpha = 0.12 + Math.sin(elapsed * 1.5 + ci) * 0.05;
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      ctx.fill();
    }
    // Denser core
    ctx.fillStyle = "#00cc33";
    ctx.globalAlpha = 0.15;
    ctx.fillRect(obs.x + 5, obs.y + 8, obs.width - 10, obs.height - 12);
    ctx.globalAlpha = 1;
    // Skull warning icon (simple pixel art)
    ctx.fillStyle = "#00ff44";
    ctx.globalAlpha = 0.3 + Math.sin(elapsed * 3) * 0.15;
    ctx.font = "bold 10px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText("☠", obs.x + obs.width / 2, obs.y + obs.height / 2 + 3);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawTunnel() {
  if (!tunnel) return;
  ctx.save();
  const t_now = visualTimeMs();
  const ent = tunnel.x;
  const entEnd = ent + tunnel.entranceWidth;
  const bodyEnd = entEnd + tunnel.bodyWidth;
  const exitEnd = bodyEnd + tunnel.exitWidth;

  if (playerUnderground) {
    // === FULL-SCREEN IMMERSIVE TUNNEL ===

    // Fill entire screen with dark tunnel background
    ctx.fillStyle = "#040410";
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Subtle wall texture — dark bricks / panels
    ctx.fillStyle = "#0a0a1a";
    for (let wy = TUNNEL_CEILING_Y; wy < UNDERGROUND_Y; wy += 20) {
      const offset = (wy % 40 === 0) ? 0 : 15;
      for (let wx = ((-groundOffset * 0.6 + offset) % 30) - 30; wx < GAME_WIDTH; wx += 30) {
        ctx.fillRect(wx, wy, 28, 18);
      }
    }

    // Ceiling — thick industrial beam
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, TUNNEL_CEILING_Y - 8, GAME_WIDTH, 12);
    ctx.fillStyle = "#222244";
    ctx.fillRect(0, TUNNEL_CEILING_Y + 4, GAME_WIDTH, 4);

    // Ceiling conduits and pipes
    for (let px = ((-groundOffset * 0.5) % 80) - 80; px < GAME_WIDTH; px += 80) {
      // Vertical pipe
      ctx.fillStyle = "#1a2a22";
      ctx.fillRect(px + 35, TUNNEL_CEILING_Y + 4, 6, 20);
      // Drip animation
      const drip = (t_now / 400 + px) % 40;
      if (drip < 20) {
        ctx.fillStyle = "#00ff66";
        ctx.globalAlpha = 0.5;
        ctx.fillRect(px + 37, TUNNEL_CEILING_Y + 24 + drip, 2, 3);
        ctx.globalAlpha = 1;
      }
      // Horizontal conduit
      ctx.fillStyle = "#151525";
      ctx.fillRect(px, TUNNEL_CEILING_Y + 6, 70, 4);
    }

    // Neon strip lights on walls (scrolling with parallax)
    const stripGlow = 0.3 + Math.sin(t_now / 500) * 0.15;
    ctx.fillStyle = "#00ff66";
    ctx.globalAlpha = stripGlow;
    ctx.fillRect(0, TUNNEL_CEILING_Y + 40, GAME_WIDTH, 1);
    ctx.fillRect(0, UNDERGROUND_Y - 25, GAME_WIDTH, 1);
    ctx.globalAlpha = 1;

    // Occasional warning signs on walls
    for (let sx = ((-groundOffset * 0.6) % 200) - 200; sx < GAME_WIDTH; sx += 200) {
      // Hazard stripe
      ctx.fillStyle = "#221100";
      ctx.fillRect(sx + 60, TUNNEL_CEILING_Y + 50, 40, 20);
      ctx.fillStyle = "#ff6600";
      ctx.globalAlpha = 0.4 + Math.sin(t_now / 300 + sx) * 0.2;
      ctx.font = "bold 7px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillText("CAUTION", sx + 80, TUNNEL_CEILING_Y + 64);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }

    // Floor — underground ground with toxic glow
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(0, UNDERGROUND_Y, GAME_WIDTH, GAME_HEIGHT - UNDERGROUND_Y);
    // Glowing floor line
    ctx.strokeStyle = "#00ff66";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6 + Math.sin(t_now / 400) * 0.2;
    ctx.beginPath();
    ctx.moveTo(0, UNDERGROUND_Y);
    ctx.lineTo(GAME_WIDTH, UNDERGROUND_Y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Floor glow gradient
    const floorGlow = ctx.createLinearGradient(0, UNDERGROUND_Y, 0, UNDERGROUND_Y + 10);
    floorGlow.addColorStop(0, "rgba(0, 255, 102, 0.12)");
    floorGlow.addColorStop(1, "rgba(0, 255, 102, 0)");
    ctx.fillStyle = floorGlow;
    ctx.fillRect(0, UNDERGROUND_Y, GAME_WIDTH, 10);

    // Rail tracks on floor
    ctx.strokeStyle = "#222233";
    ctx.lineWidth = 1;
    for (let rail = 0; rail < 2; rail++) {
      const ry = UNDERGROUND_Y + 3 + rail * 4;
      ctx.beginPath();
      ctx.moveTo(0, ry);
      ctx.lineTo(GAME_WIDTH, ry);
      ctx.stroke();
    }
    // Rail ties (cross-beams)
    ctx.fillStyle = "#181828";
    for (let tx = ((-groundOffset * 0.8) % 25) - 25; tx < GAME_WIDTH; tx += 25) {
      ctx.fillRect(tx, UNDERGROUND_Y + 2, 8, 6);
    }

    // Exit light — bright opening visible ahead when approaching exit
    const exitScreenX = exitEnd;
    if (exitScreenX > 0 && exitScreenX < GAME_WIDTH + 100) {
      // Bright light cone from exit
      const lightGrad = ctx.createLinearGradient(exitScreenX - 120, 0, exitScreenX, 0);
      lightGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
      lightGrad.addColorStop(1, "rgba(100, 140, 200, 0.15)");
      ctx.fillStyle = lightGrad;
      ctx.fillRect(exitScreenX - 120, TUNNEL_CEILING_Y, 120, UNDERGROUND_Y - TUNNEL_CEILING_Y);
      // Exit marker
      ctx.fillStyle = "#88aacc";
      ctx.globalAlpha = 0.6 + Math.sin(t_now / 200) * 0.3;
      ctx.font = "bold 9px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillText("EXIT", exitScreenX - 20, GROUND_Y + 20);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }

    // Entrance visible behind player
    const entScreenX = ent;
    if (entScreenX > -100 && entScreenX < GAME_WIDTH) {
      const entGrad = ctx.createLinearGradient(entScreenX, 0, entScreenX + 100, 0);
      entGrad.addColorStop(0, "rgba(100, 140, 200, 0.1)");
      entGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = entGrad;
      ctx.fillRect(entScreenX, TUNNEL_CEILING_Y, 100, UNDERGROUND_Y - TUNNEL_CEILING_Y);
    }

    // Ambient particles — dust motes
    ctx.fillStyle = "#00ff66";
    for (let i = 0; i < 8; i++) {
      const dx = ((t_now * 0.02 + i * 107) % GAME_WIDTH);
      const dy = TUNNEL_CEILING_Y + 30 + ((t_now * 0.01 + i * 73) % (UNDERGROUND_Y - TUNNEL_CEILING_Y - 40));
      ctx.globalAlpha = 0.15 + Math.sin(t_now / 300 + i) * 0.1;
      ctx.fillRect(dx, dy, 2, 2);
    }
    ctx.globalAlpha = 1;

  } else {
    // === SURFACE VIEW — show tunnel entrance/exit from above ===

    // Underground pit background (dark)
    ctx.fillStyle = "#060612";
    ctx.beginPath();
    ctx.moveTo(ent, GROUND_Y);
    ctx.lineTo(entEnd, UNDERGROUND_Y);
    ctx.lineTo(bodyEnd, UNDERGROUND_Y);
    ctx.lineTo(exitEnd, GROUND_Y);
    ctx.closePath();
    ctx.fill();

    // Underground ground line (toxic green glow)
    ctx.strokeStyle = "#00ff66";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5 + Math.sin(t_now / 400) * 0.2;
    ctx.beginPath();
    ctx.moveTo(entEnd, UNDERGROUND_Y);
    ctx.lineTo(bodyEnd, UNDERGROUND_Y);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Glow under the underground ground line
    const ugGlow = ctx.createLinearGradient(0, UNDERGROUND_Y, 0, UNDERGROUND_Y + 6);
    ugGlow.addColorStop(0, "rgba(0, 255, 102, 0.15)");
    ugGlow.addColorStop(1, "rgba(0, 255, 102, 0)");
    ctx.fillStyle = ugGlow;
    ctx.fillRect(entEnd, UNDERGROUND_Y, bodyEnd - entEnd, 6);

    // Ceiling at GROUND_Y with dripping pipes
    ctx.strokeStyle = "#333355";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(entEnd, GROUND_Y);
    ctx.lineTo(bodyEnd, GROUND_Y);
    ctx.stroke();

    // Pipe details on ceiling
    for (let px = entEnd + 30; px < bodyEnd - 30; px += 60) {
      ctx.fillStyle = "#224433";
      ctx.fillRect(px, GROUND_Y, 4, 15);
      const drip = (t_now / 500 + px) % 30;
      if (drip < 15) {
        ctx.fillStyle = "#00ff66";
        ctx.globalAlpha = 0.4;
        ctx.fillRect(px + 1, GROUND_Y + 15 + drip, 2, 3);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "#1a2a1a";
      ctx.fillRect(px - 20, GROUND_Y + 2, 44, 3);
    }

    // Entrance ramp edges
    ctx.strokeStyle = "#ff00ff";
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(ent, GROUND_Y);
    ctx.lineTo(entEnd, UNDERGROUND_Y);
    ctx.stroke();
    // Exit ramp edges
    ctx.beginPath();
    ctx.moveTo(bodyEnd, UNDERGROUND_Y);
    ctx.lineTo(exitEnd, GROUND_Y);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // "DANGER" warning text at entrance
    ctx.font = "bold 8px 'Courier New', monospace";
    ctx.fillStyle = "#ff6600";
    ctx.globalAlpha = 0.5 + Math.sin(t_now / 300) * 0.3;
    ctx.textAlign = "center";
    ctx.fillText("DANGER", ent + tunnel.entranceWidth / 2, GROUND_Y - 4);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawProjectiles() {
  ctx.save();
  for (const b of projectiles) {
    const t = visualTimeMs();
    // Neon bullet core
    ctx.fillStyle = "#00ffcc";
    ctx.globalAlpha = 0.9 * b.life;
    ctx.fillRect(b.x, b.y, BULLET_WIDTH, BULLET_HEIGHT);
    // Bright center line
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.7 * b.life;
    ctx.fillRect(b.x + 2, b.y + 1, BULLET_WIDTH - 4, 1);
    // Glow trail
    ctx.fillStyle = "#00ffcc";
    ctx.globalAlpha = 0.15 * b.life;
    ctx.fillRect(b.x - 8, b.y - 2, BULLET_WIDTH + 8, BULLET_HEIGHT + 4);
    // Trailing particles (small)
    ctx.fillStyle = "#00ffcc";
    ctx.globalAlpha = 0.3 * b.life;
    ctx.fillRect(b.x - 4 - Math.random() * 6, b.y + Math.random() * BULLET_HEIGHT, 3, 1);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawKillPopup() {
  if (killFlashTimer > 0 && lastKillText) {
    ctx.save();
    ctx.font = "bold 14px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff4444";
    ctx.globalAlpha = killFlashTimer / 8;
    const popY = player.y - 20 - (8 - killFlashTimer) * 2;
    ctx.fillText(lastKillText, player.x + player.width / 2, popY);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    // Glow for bright particles
    if (p.life > 0.5 && p.size > 2) {
      ctx.globalAlpha = p.life * 0.2;
      ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
    }
  }
  ctx.globalAlpha = 1;
}

function drawScanlines() {
  if (prefersReducedMotion) return;
  ctx.globalAlpha = 0.03;
  ctx.fillStyle = "#000000";
  for (let y = 0; y < GAME_HEIGHT; y += 3) {
    ctx.fillRect(0, y, GAME_WIDTH, 1);
  }
  ctx.globalAlpha = 1;
}

function drawHUD() {
  if (state !== "playing") return;

  // Speed indicator — wider bar with rounded ends feel
  const speedPct = (gameSpeed - INITIAL_SPEED) / (MAX_SPEED - INITIAL_SPEED);
  ctx.fillStyle = "#181828";
  ctx.fillRect(12, 12, 70, 7);
  ctx.strokeStyle = "#333344";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(12, 12, 70, 7);
  const barGrad = ctx.createLinearGradient(12, 0, 82, 0);
  barGrad.addColorStop(0, "#00ffcc");
  barGrad.addColorStop(1, "#ff00ff");
  ctx.fillStyle = barGrad;
  ctx.fillRect(12, 12, 70 * speedPct, 7);
  // Speed glow at bar tip
  if (speedPct > 0.1) {
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.4;
    ctx.fillRect(12 + 70 * speedPct - 2, 12, 2, 7);
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = "#666677";
  ctx.font = "bold 9px 'Courier New', monospace";
  ctx.fillText("SPD", 14, 29);

  // Difficulty tier label
  if (difficultyTier) {
    ctx.save();
    ctx.font = "bold 10px 'Courier New', monospace";
    ctx.textAlign = "right";
    const tierColors = {
      "DOUBLE JUMP": "#ff00ff",
      "HIGH SPEED": "#ffaa00",
      "DANGER ZONE": "#ff4444",
      "OVERDRIVE": "#ff0066",
      "TUNNELS": "#00ff66",
      "UNDERGROUND": "#00ff66",
      "HOVER PACK": "#ff6600",
    };
    const tierColor = tierColors[difficultyTier] || "#00ffcc";
    ctx.fillStyle = tierColor;
    ctx.globalAlpha = 0.7 + Math.sin(visualTimeMs() / 400) * 0.3;
    ctx.shadowColor = tierColor;
    ctx.shadowBlur = 6;
    ctx.fillText(difficultyTier, GAME_WIDTH - 40, 28);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Time-of-day / weather label
  if (state === "playing" && !playerUnderground) {
    const period = getCurrentTimePeriod();
    const timeColors = {
      "DUSK": "#cc66aa", "NIGHT": "#6666aa", "MIDNIGHT": "#8844cc",
      "ACID RAIN": "#00ff66", "LATE NIGHT": "#6666aa", "NEON FOG": "#cc44ff",
      "STORM": "#6688ff", "PRE-DAWN": "#cc6688",
    };

    // Detect time period transition
    if (currentTimePeriodName && currentTimePeriodName !== period.name) {
      timePeriodFlashTimer = 120; // ~2 seconds
    }
    currentTimePeriodName = period.name;

    const periodColor = timeColors[period.name] || "#666688";
    ctx.save();

    // Big transition announcement
    if (timePeriodFlashTimer > 0) {
      const flashAlpha = Math.min(1, timePeriodFlashTimer / 40) * 0.8;
      ctx.font = "bold 16px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = periodColor;
      ctx.globalAlpha = flashAlpha;
      ctx.shadowColor = periodColor;
      ctx.shadowBlur = 12;
      ctx.fillText(period.name, GAME_WIDTH / 2, 84);
      ctx.shadowBlur = 0;
      // Thin line accent
      ctx.globalAlpha = flashAlpha * 0.3;
      ctx.fillRect(GAME_WIDTH / 2 - 80, 90, 160, 1);
      ctx.textAlign = "left";
    }

    // Persistent small label
    ctx.font = "9px 'Courier New', monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = periodColor;
    ctx.globalAlpha = 0.6 + Math.sin(visualTimeMs() / 600) * 0.15;
    ctx.fillText(period.name, GAME_WIDTH - 40, 38);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Double jump indicator
  if (player.canDoubleJump) {
    const maxJumps = 2;
    const jumpsLeft = maxJumps - player.jumpsUsed;
    const djY = 35;
    ctx.font = "bold 9px 'Courier New', monospace";
    ctx.fillStyle = "#666677";
    ctx.fillText("JUMP", 14, djY);
    for (let i = 0; i < maxJumps; i++) {
      const ix = 50 + i * 14;
      if (i < jumpsLeft) {
        ctx.fillStyle = "#ff00ff";
        ctx.globalAlpha = 0.8 + Math.sin(visualTimeMs() / 300) * 0.2;
        ctx.shadowColor = "#ff00ff";
        ctx.shadowBlur = 4;
      } else {
        ctx.fillStyle = "#332233";
        ctx.globalAlpha = 0.4;
        ctx.shadowBlur = 0;
      }
      // Upward chevron
      ctx.beginPath();
      ctx.moveTo(ix, djY);
      ctx.lineTo(ix + 5, djY - 7);
      ctx.lineTo(ix + 10, djY);
      ctx.lineTo(ix + 7, djY);
      ctx.lineTo(ix + 5, djY - 4);
      ctx.lineTo(ix + 3, djY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  } else if (score > ADVANCED_PHASE_SCORE * 0.7) {
    // Tease: approaching unlock
    const pct = (score - ADVANCED_PHASE_SCORE * 0.7) / (ADVANCED_PHASE_SCORE * 0.3);
    ctx.fillStyle = "#ff00ff";
    ctx.globalAlpha = 0.15 + pct * 0.25;
    ctx.font = "9px 'Courier New', monospace";
    ctx.fillText("x2 JUMP " + Math.floor(pct * 100) + "%", 14, 42);
    ctx.globalAlpha = 1;
  }

  // Jetpack fuel meter — wider and clearer
  if (jetpackUnlocked) {
    const fuelPct = jetpackFuel / JETPACK_MAX_FUEL;
    const fuelY = player.canDoubleJump ? 44 : 35;
    ctx.fillStyle = "#181828";
    ctx.fillRect(12, fuelY, 50, 6);
    ctx.strokeStyle = "#333344";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(12, fuelY, 50, 6);
    const fuelColor = fuelPct > 0.3 ? "#ff6600" : "#ff2200";
    ctx.fillStyle = fuelColor;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(12, fuelY, 50 * fuelPct, 6);
    // Low fuel flash
    if (fuelPct < 0.2 && fuelPct > 0) {
      ctx.globalAlpha = 0.3 + Math.sin(visualTimeMs() / 100) * 0.3;
      ctx.fillRect(12, fuelY, 50 * fuelPct, 6);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#666677";
    ctx.font = "bold 9px 'Courier New', monospace";
    ctx.fillText("JET", 14, fuelY + 14);
  }

  // Drone kills counter
  if (droneKills > 0) {
    const killY = jetpackUnlocked ? (player.canDoubleJump ? 66 : 57) : (player.canDoubleJump ? 50 : 42);
    ctx.fillStyle = "#ff4444";
    ctx.globalAlpha = 0.8;
    ctx.font = "bold 9px 'Courier New', monospace";
    ctx.fillText("KILLS " + droneKills, 14, killY);
    ctx.globalAlpha = 1;
  }

  // Shoot cooldown indicator (bar above player)
  if (shootCooldown > 0) {
    const cdPct = shootCooldown / SHOOT_COOLDOWN;
    // Background
    ctx.fillStyle = "#181828";
    ctx.globalAlpha = 0.4;
    ctx.fillRect(player.x, player.y - 8, player.width, 3);
    // Fill
    ctx.fillStyle = "#00ffcc";
    ctx.globalAlpha = 0.6;
    ctx.fillRect(player.x, player.y - 8, player.width * (1 - cdPct), 3);
    ctx.globalAlpha = 1;
  }

  // Touch zone hint (fades out)
  if (isTouchDevice && touchHintTimer > 0) {
    const hintAlpha = Math.min(0.4, touchHintTimer / 120 * 0.4);

    // Horizontal divider
    ctx.strokeStyle = "#00ffcc";
    ctx.lineWidth = 1;
    ctx.globalAlpha = hintAlpha * 0.5;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(0, GAME_HEIGHT / 2);
    ctx.lineTo(GAME_WIDTH * 0.66, GAME_HEIGHT / 2);
    ctx.stroke();

    // Vertical divider for shoot zone
    ctx.strokeStyle = "#ff4444";
    ctx.beginPath();
    ctx.moveTo(GAME_WIDTH * 0.66, 0);
    ctx.lineTo(GAME_WIDTH * 0.66, GAME_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);

    // Labels
    ctx.font = "bold 14px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.globalAlpha = hintAlpha;
    ctx.fillStyle = "#00ffcc";
    ctx.fillText("TAP TO JUMP", GAME_WIDTH * 0.33, GAME_HEIGHT / 2 - 30);
    ctx.fillStyle = "#ff00ff";
    ctx.fillText("TAP TO SLIDE", GAME_WIDTH * 0.33, GAME_HEIGHT / 2 + 45);
    ctx.fillStyle = "#ff4444";
    ctx.fillText("TAP TO", GAME_WIDTH * 0.83, GAME_HEIGHT / 2 - 10);
    ctx.fillText("SHOOT", GAME_WIDTH * 0.83, GAME_HEIGHT / 2 + 10);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }

  // Pause icon (desktop only — mobile uses the HTML button)
  if (!isTouchDevice) {
    ctx.fillStyle = "#555566";
    ctx.globalAlpha = 0.5;
    ctx.fillRect(GAME_WIDTH - 30, 12, 4, 12);
    ctx.fillRect(GAME_WIDTH - 22, 12, 4, 12);
    ctx.globalAlpha = 1;
  }
}

function drawPlayBandShade() {
  if (playerUnderground) return;
  const shade = ctx.createLinearGradient(0, 80, 0, GROUND_Y);
  shade.addColorStop(0, "rgba(2, 2, 12, 0.12)");
  shade.addColorStop(0.45, "rgba(2, 2, 12, 0.4)");
  shade.addColorStop(1, "rgba(2, 2, 12, 0.58)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 80, GAME_WIDTH, GROUND_Y - 80);
}

function drawHazardRim(obstacle) {
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.shadowColor = "#ff3355";
  ctx.shadowBlur = 8;
  ctx.strokeRect(
    obstacle.x - 1,
    obstacle.y - 1,
    obstacle.width + 2,
    obstacle.height + 2,
  );
  ctx.restore();
}

function draw() {
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  // Screen shake
  const shaking = !prefersReducedMotion && screenShake > 0;
  if (shaking) {
    ctx.save();
    const shakeX = (Math.random() - 0.5) * screenShake * 1.2;
    const shakeY = (Math.random() - 0.5) * screenShake * 1.2;
    ctx.translate(shakeX, shakeY);
  }

  drawSky();
  drawStars();
  drawMoon();
  drawCityLayer(farBuildings, 0.15, 0.5);
  drawCityLayer(buildings, 0.4, 0.7);
  drawWeather(); // rain/fog/lightning between buildings and ground
  drawPlayBandShade();
  drawGround();
  drawTunnel();

  // When underground, the immersive tunnel drawTunnel() covers the full screen.
  // No additional sky darkening needed — the tunnel IS the environment.

  if (state === "playing" || state === "gameover" || state === "paused" || state === "entering_initials") {
    for (const obs of obstacles) {
      drawObstacle(obs);
      drawHazardRim(obs);
    }
  }
  if (state === "playing" || state === "paused") {
    drawPlayer();
    // Draw jetpack flame glow on player when active
    if (jetpackActive) {
      ctx.save();
      ctx.fillStyle = "#ff6600";
      ctx.globalAlpha = 0.3 + Math.sin(visualTimeMs() / 50) * 0.15;
      ctx.fillRect(player.x + 4, player.y + player.height - 2, player.width - 8, 8);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  drawProjectiles();
  drawParticles();
  drawHUD();
  drawKillPopup();

  // Countdown overlay (after OK is clicked on unlock pause)
  if (countdownTimer > 0 && !unlockPause && state === "paused") {
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    const cx2 = GAME_WIDTH / 2;
    const cy2 = GAME_HEIGHT / 2;
    const num = countdownNumber;
    const scale = prefersReducedMotion
      ? 1
      : 1 + (1 - (countdownTimer % FRAMES_PER_SECOND) / FRAMES_PER_SECOND) * 0.3;
    ctx.font = `bold ${Math.floor(72 * scale)}px 'Courier New', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#00ffcc";
    ctx.shadowColor = "#00ffcc";
    ctx.shadowBlur = 20;
    ctx.globalAlpha = Math.min(1, (countdownTimer % FRAMES_PER_SECOND) / 10);
    ctx.fillText(num > 0 ? String(num) : "GO!", cx2, cy2);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.restore();
  }

  // Flash notifications (after unlock pause is dismissed, these continue briefly)
  if (!unlockPause) {
    if (tunnelFlashTimer > 0) {
      const alpha = Math.min(1, tunnelFlashTimer / 30) * (0.7 + Math.sin(visualTimeMs() / 100) * 0.3);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = "bold 20px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#00ff66";
      ctx.shadowColor = "#00ff66";
      ctx.shadowBlur = 15;
      ctx.fillText("UNDERGROUND UNLOCKED", GAME_WIDTH / 2, 84);
      ctx.shadowBlur = 0;
      ctx.textAlign = "left";
      ctx.restore();
    }
    if (unlockFlashTimer > 0) {
      const alpha = Math.min(1, unlockFlashTimer / 30) * (0.7 + Math.sin(visualTimeMs() / 100) * 0.3);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = "bold 20px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#ff00ff";
      ctx.shadowColor = "#ff00ff";
      ctx.shadowBlur = 15;
      ctx.fillText("DOUBLE JUMP UNLOCKED", GAME_WIDTH / 2, 84);
      ctx.shadowBlur = 0;
      ctx.textAlign = "left";
      ctx.restore();
    }
    if (jetpackFlashTimer > 0) {
      const alpha = Math.min(1, jetpackFlashTimer / 30) * (0.7 + Math.sin(visualTimeMs() / 100) * 0.3);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = "bold 20px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#ff6600";
      ctx.shadowColor = "#ff6600";
      ctx.shadowBlur = 15;
      ctx.fillText("HOVER PACK UNLOCKED", GAME_WIDTH / 2, 84);
      ctx.shadowBlur = 0;
      ctx.textAlign = "left";
      ctx.restore();
    }
  }

  // Death flash overlay
  if (deathFlash > 0) {
    ctx.fillStyle = "#ff0033";
    ctx.globalAlpha = deathFlash / 15 * 0.35;
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ctx.globalAlpha = 1;
  }

  drawScanlines();

  // Close screen shake transform
  if (shaking) {
    ctx.restore();
  }
}

function updatePostEffects() {
  if (screenShake > 0) screenShake--;
  if (deathFlash > 0) deathFlash--;
}

function update() {
  // Handle countdown timer (runs while still paused)
  if (state === "paused" && countdownTimer > 0) {
    countdownTimer--;
    countdownNumber = Math.ceil(countdownTimer / FRAMES_PER_SECOND);
    if (countdownNumber !== lastCountdownNumber) {
      lastCountdownNumber = countdownNumber;
      playCue(countdownNumber > 0 ? "countdown" : "go");
    }
    if (countdownTimer <= 0) {
      countdownNumber = 0;
      resumeGame();
    }
    return;
  }
  if (state === "paused") return;
  if (state !== "playing") {
    updateParticles();
    updatePostEffects();
    return;
  }

  simulationTimeMs += FIXED_STEP_MS;
  activeRunTimeMs = advanceActiveRunTime(activeRunTimeMs, state);

  // Decrement touch hint timer
  if (touchHintTimer > 0) touchHintTimer--;
  if (timePeriodFlashTimer > 0) timePeriodFlashTimer--;

  // Progressive speed: gentle while unlocking mechanics, then ramps up
  let speedIncrement = 0.001;
  if (score >= COMBO_OBSTACLE_SCORE) {
    speedIncrement = 0.003;
    difficultyTier = playerUnderground ? "UNDERGROUND" : "OVERDRIVE";
  } else if (score >= FAST_DRONE_SCORE) {
    speedIncrement = 0.0025;
    difficultyTier = playerUnderground ? "UNDERGROUND" : "DANGER ZONE";
  } else if (score >= SPEED_TIER_SCORE) {
    speedIncrement = 0.002;
    difficultyTier = playerUnderground ? "UNDERGROUND" : "HIGH SPEED";
  } else if (score >= JETPACK_SCORE) {
    speedIncrement = 0.0015;
    difficultyTier = playerUnderground ? "UNDERGROUND" : "HOVER PACK";
  } else if (score >= ADVANCED_PHASE_SCORE) {
    speedIncrement = 0.001;
    difficultyTier = playerUnderground ? "UNDERGROUND" : "DOUBLE JUMP";
  } else if (score >= TUNNEL_SCORE) {
    speedIncrement = 0.001;
    difficultyTier = playerUnderground ? "UNDERGROUND" : "TUNNELS";
  } else {
    difficultyTier = "";
  }
  gameSpeed = Math.min(MAX_SPEED, INITIAL_SPEED + score * speedIncrement);
  if (gameSpeed > maxSpeedReached) maxSpeedReached = gameSpeed;
  score = advanceScore(score, gameSpeed);
  groundOffset += gameSpeed;

  // First encounter uses a focused DOM tutorial; later runs keep arcade flow.
  if (shouldUnlock(tunnelUnlocked, score, TUNNEL_SCORE)) {
    tunnelUnlocked = true;
    const tutorialSeen = hasSeenTutorial("tunnel");
    tunnelFlashTimer = tutorialSeen ? 90 : 0;
    const tutorial = {
      title: "UNDERGROUND UNLOCKED",
      lines: ["Tunnels will appear in the road ahead.", "You'll descend into them automatically.", "Watch for pipes, lasers, and hazards below!"],
      color: "#00ff66",
    };
    if (tutorialSeen) feedback("unlock");
    else showUnlockTutorial("tunnel", tutorial);
  }
  if (tunnelFlashTimer > 0) tunnelFlashTimer--;

  // Check for double jump unlock — pause with instructions
  if (shouldUnlock(doubleJumpUnlocked, score, ADVANCED_PHASE_SCORE)) {
    doubleJumpUnlocked = true;
    const tutorialSeen = hasSeenTutorial("double-jump");
    unlockFlashTimer = tutorialSeen ? 90 : 0;
    const tutorial = {
      title: "DOUBLE JUMP UNLOCKED",
      lines: isTouchDevice
        ? ["Tap jump twice to double jump!", "Use it to clear firewalls and combo obstacles."]
        : ["Press Space/Up twice to double jump!", "Use it to clear firewalls and combo obstacles."],
      color: "#ff00ff",
    };
    if (tutorialSeen) feedback("unlock");
    else showUnlockTutorial("double-jump", tutorial);
  }
  if (unlockFlashTimer > 0) unlockFlashTimer--;

  // Check for jetpack unlock — pause with instructions
  if (shouldUnlock(jetpackUnlocked, score, JETPACK_SCORE)) {
    jetpackUnlocked = true;
    const tutorialSeen = hasSeenTutorial("jetpack");
    jetpackFlashTimer = tutorialSeen ? 90 : 0;
    const tutorial = {
      title: "HOVER PACK UNLOCKED",
      lines: isTouchDevice
        ? ["Hold the jump zone to hover!", "Fuel drains while hovering, recharges on ground.", "Use it to fly over obstacles."]
        : ["Hold Space/Up to hover!", "Fuel drains while hovering, recharges on ground.", "Use it to fly over obstacles."],
      color: "#ff6600",
    };
    if (tutorialSeen) feedback("unlock");
    else showUnlockTutorial("jetpack", tutorial);
  }
  if (jetpackFlashTimer > 0) jetpackFlashTimer--;

  if (state === "paused") {
    document.getElementById("score-display").textContent =
      "SCORE " + String(Math.floor(score)).padStart(6, "0");
    return;
  }

  updatePlayer();
  updateTunnel();
  updateObstacles();
  updateProjectiles();
  checkCollisions();
  updateParticles();
  updateWeather();
  updatePostEffects();

  document.getElementById("score-display").textContent =
    "SCORE " + String(Math.floor(score)).padStart(6, "0");
}

function gameLoop(timestamp) {
  frameClock.advance(timestamp, update);
  draw();
  requestAnimationFrame(gameLoop);
}

// Responsive scaling
function resizeCanvas() {
  const bodyStyle = window.getComputedStyle(document.body);
  const horizontalPadding = parseFloat(bodyStyle.paddingLeft) + parseFloat(bodyStyle.paddingRight);
  const verticalPadding = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
  const maxW = Math.max(1, window.innerWidth - horizontalPadding);
  const maxH = Math.max(1, window.innerHeight - verticalPadding);
  const ratio = GAME_WIDTH / GAME_HEIGHT;
  let displayW = maxW;
  let displayH = maxW / ratio;
  if (displayH > maxH) {
    displayH = maxH;
    displayW = maxH * ratio;
  }
  canvas.style.width = displayW + "px";
  canvas.style.height = displayH + "px";
  pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  const backingWidth = Math.round(GAME_WIDTH * pixelRatio);
  const backingHeight = Math.round(GAME_HEIGHT * pixelRatio);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  const container = document.getElementById("game-container");
  container.style.width = displayW + "px";
  container.style.height = displayH + "px";
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

renderLeaderboardHTML("start-leaderboard");
updateFeedbackButtons();
canvas.tabIndex = -1;
elements.startButton.focus({ preventScroll: true });
requestAnimationFrame(gameLoop);
