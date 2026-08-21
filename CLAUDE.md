# Neon Sprint - Handoff Document

## What Is This?

**Neon Sprint** is a cyberpunk-themed endless runner arcade game built entirely with vanilla JavaScript and HTML5 Canvas. Created by Chris Phelan as an experiment with Claude Code — the entire game was developed through iterative AI-assisted sessions, from blank repo to full-featured arcade game.

No frameworks. No build step. Just `game.js`, `index.html`, and `stylesheet.css`.

---

## Tech Stack

- **Rendering**: HTML5 Canvas 2D (800x350 base resolution, responsive scaling)
- **Language**: Vanilla ES6+ JavaScript (~2,900 lines in game.js)
- **Storage**: localStorage for leaderboard persistence
- **Styling**: Pure CSS with neon glow effects and responsive media queries
- **Testing**: Node unit tests plus Playwright browser smoke tests
- **Deployment**: GitHub Pages via GitHub Actions (static site)

---

## File Structure

```
├── game.js            # All game logic, physics, rendering, state management
├── game-core.js       # Deterministic timing, collision, and pointer-input primitives
├── index.html         # Canvas element, UI overlays, touch controls
├── stylesheet.css     # Neon-themed styling, animations, responsive layout
├── package.json       # npm scripts and htmlhint dev dependency
├── test/              # Structural, unit, and Playwright browser tests
└── .github/workflows/ # GitHub Actions for Pages deployment
```

Everything lives in `game.js` — it's a single-file game engine. This was intentional to keep things simple for the AI-assisted workflow.

---

## Game Features (in order they were built)

### Core Mechanics
1. **Endless runner** with auto-scrolling and increasing speed
2. **Jump** (Space/Up) and **Slide** (Down) to avoid obstacles
3. **Collision detection** against multiple obstacle types

### Progressive Unlock System (score-gated)
The game unlocks mechanics *before* ramping speed, so players learn each system:

| Score | Unlock |
|-------|--------|
| 400 | Underground tunnels |
| 800 | Double jump + Firewall obstacles |
| 1200 | Jetpack/Hover pack (fuel-managed) |
| 1500+ | Speed tiers: HIGH SPEED → DANGER ZONE → OVERDRIVE |

Each unlock shows an accessible tutorial once. Later runs use a brief HUD notification without interrupting play.

### Obstacle Types
- **Traffic barriers, bollards, server racks** — ground obstacles
- **Drones** — hovering enemies with vertical oscillation, shootable
- **Firewalls** — tall barriers requiring double jump
- **Underground pipes** — tunnel-specific hazards

### Underground Tunnel System
- Full immersive tunnels with ceiling, separate ground level, and entrance/exit ramps
- Automatic player descent into tunnels
- Separate obstacle spawning with tighter gaps
- Grace period on tunnel exit to prevent unfair deaths

### Jetpack Hover
- Hold jump while airborne to hover
- Fuel system (100 units, burns at 1.2/frame, recharges at 0.8/frame on ground)
- Visual fuel meter in HUD

### Shooting System
- **X/K** keys (desktop) or right touch zone (mobile) fire projectiles
- 12-frame cooldown between shots
- Destroys drones for 50 bonus points each
- Muzzle flash particles and kill popup text

### Time-of-Day Cycle & Weather
8 atmospheric periods cycling based on score progression:
- DUSK → NIGHT → ACID RAIN → MIDNIGHT → NEON FOG → STORM → LATE NIGHT → PRE-DAWN
- Each period has unique sky gradients, star/moon visibility, atmospheric haze
- Weather effects: lightning strikes (STORM), rain particles (ACID RAIN), snow

### Visual Polish
- Parallax scrolling city skyline (two layers with window details and neon glow)
- Particle system for muzzle flash, explosions, death burst
- CRT scanline overlay
- Screen shake on death
- Glitch animation on game over title

### Arcade Leaderboard
- Top 5 scores saved to localStorage
- 3-letter initials entry (arcade-style)
- Shown on start screen and game over

### Mobile Support
- Full touch controls (left-top = jump, left-bottom = slide, right = shoot)
- Portrait support with a non-blocking landscape recommendation
- Responsive canvas scaling
- Independent Pointer Events for simultaneous jump/slide and shoot input
- Touch hint labels for first play

---

## Game States

```
"start" → "playing" → "paused" → "playing" → "gameover" → "entering_initials" → "start"
```

Unlock pauses also use the `"paused"` state with a countdown timer.

---

## How the Game Loop Works

`requestAnimationFrame` renders the game, while a fixed-timestep clock advances gameplay at 60 simulation steps per second. Multiple updates may run before a render on a slower display, and faster displays may render between updates without changing gameplay speed.

**Update order**: speed scaling → unlock checks → player physics → tunnel updates → obstacle spawning/movement → projectiles → collisions → particles → weather

**Draw order**: sky gradient → stars → moon → weather → far buildings → near buildings → ground → tunnel → obstacles → projectiles → player → particles → kill popups → HUD → scanlines → UI overlays

---

## Key Constants to Tweak

In `game.js`, near the top:

| Constant | Default | What it does |
|----------|---------|--------------|
| `GROUND_Y` | 290 | Surface ground level |
| `UNDERGROUND_Y` | 340 | Tunnel floor level |
| `JUMP_FORCE` | -13 | Initial jump velocity |
| `GRAVITY` | 0.6 | Gravity per frame |
| `DOUBLE_JUMP_SCORE` | 800 | Score to unlock double jump |
| `JETPACK_SCORE` | 1200 | Score to unlock hover |
| `TUNNEL_SCORE` | 400 | Score to unlock tunnels |

Speed scales from ~5 to ~14 px/frame based on score.

---

## Development History

Built across ~35 commits, roughly in this order:

1. **Basic runner** — jump, duck, obstacles, parallax city background
2. **Mobile support** — touch controls, responsive scaling, portrait detection
3. **Double jump + firewalls** — new mechanic + obstacle type that needs it
4. **Leaderboard** — arcade-style initials, localStorage, top 5
5. **Progressive difficulty** — score-gated unlocks instead of just speed ramp
6. **Underground tunnels** — full immersive tunnel system with separate obstacles
7. **Jetpack hover** — fuel-managed flight with visual meter
8. **Shooting** — Tab to fire, drone destruction, kill counter
9. **Time/weather cycle** — 8 atmospheric periods with rain, lightning, snow
10. **UI polish** — unlock dialogues with OK button, countdowns, tutorial hints
11. **Title screen** — cyberpunk taglines and credit line

---

## Running Locally

```bash
# Install dev dependencies (htmlhint)
npm install

# Run structural and unit tests
npm test

# Run browser smoke tests (after installing Chromium once)
npx playwright install --with-deps chromium
npm run test:browser

# Serve locally (any static server works)
npx serve .
# or just open index.html in a browser
```

---

## Known Quirks / Areas for Improvement

- `game.js` remains a large rendering/browser module; deterministic primitives now live in `game-core.js`.
- Obstacle spawn timing uses `Math.random()` checks per frame rather than a proper interval/queue system. Occasionally spawns can cluster.
- The tunnel system auto-descends the player rather than letting them choose to enter. Could be made optional.
- No persistent online leaderboard — localStorage only.

---

## Credit

Created by **Chris Phelan** — an experiment with **Claude Code**.
