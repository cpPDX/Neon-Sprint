# Neon Sprint

Neon Sprint is a cyberpunk endless runner built with vanilla JavaScript and HTML5 Canvas. Sprint, slide, shoot, and descend through an evolving city while tunnels, double jump, hover, faster drones, and combo hazards unlock across each run.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Jump / hover | `Space`, `Up`, or `W` | Hold the upper-left zone |
| Slide | `Down` or `S` | Hold the lower-left zone |
| Shoot | `X` or `K` | Tap the right zone |
| Pause | `Escape` | Pause button |

Menus, pause actions, unlock guidance, and initials entry use standard HTML controls and support normal keyboard focus. Portrait play is supported; landscape is only a recommendation.

## Highlights

- Progressive run mechanics: tunnels, double jump, firewalls, hover pack, and speed tiers
- Multiple surface and underground hazards
- Shootable drones, score bonuses, and local top-five leaderboard
- Eight time-of-day and weather phases
- Synthesized sound cues and optional device haptics, both user-toggleable
- Reduced-motion support, browser zoom support, safe-area handling, and DPR-aware rendering
- Fixed 60 Hz gameplay simulation so speed and scoring do not depend on display refresh rate

## Run locally

```bash
npm install
npx serve .
```

Then open the local URL printed by the server.

## Validate

```bash
npm run lint
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

The Node test suite covers fixed-time scoring, collision boundaries, unlock transitions, simultaneous pointer input, pause-aware survival time, and initials normalization. Playwright covers keyboard-only navigation, reduced motion, 200% zoom, portrait play, and multi-pointer smoke behavior.

## Architecture

- `game.js` owns game state, rendering, audio feedback, and browser integration.
- `game-core.js` contains deterministic, browser-independent timing, collision, input, and normalization primitives.
- `index.html` and `stylesheet.css` provide the canvas shell and accessible DOM overlays.
- `test/` contains structural, unit, and browser smoke coverage.

The game renders at an 800×350 logical resolution. The backing canvas scales to the device pixel ratio, while gameplay advances in fixed `1/60` second steps.

## Deployment

GitHub Pages deploys through `.github/workflows/static.yml` after lint, unit, and browser checks pass.

## Credit

Created by Chris Phelan as an experiment in AI-assisted game development.

## License

See [LICENSE](LICENSE).
