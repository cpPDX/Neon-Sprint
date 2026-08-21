const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FIXED_STEP_MS,
  advanceActiveRunTime,
  advanceScore,
  createFixedStepClock,
  createPointerInputState,
  normalizeInitials,
  rectanglesOverlap,
  shouldUnlock,
} = require("../game-core.js");

function simulateOneSecond(refreshRate) {
  const clock = createFixedStepClock();
  let steps = 0;
  let score = 0;
  clock.advance(0, () => {});

  for (let frame = 1; frame <= refreshRate; frame++) {
    clock.advance((frame / refreshRate) * 1000, () => {
      steps++;
      score = advanceScore(score, 5);
    });
  }

  return { steps, score };
}

test("simulation speed and scoring are identical across refresh rates", () => {
  const results = [30, 60, 120, 144].map(simulateOneSecond);
  for (const result of results) {
    assert.equal(result.steps, 60);
    assert.equal(result.score, 15);
  }
});

test("collision boundaries do not count edge-only contact", () => {
  const player = { x: 10, y: 10, width: 20, height: 20 };
  assert.equal(rectanglesOverlap(player, { x: 29, y: 10, width: 10, height: 10 }), true);
  assert.equal(rectanglesOverlap(player, { x: 30, y: 10, width: 10, height: 10 }), false);
  assert.equal(rectanglesOverlap(player, { x: 31, y: 10, width: 10, height: 10 }), false);
});

test("unlock transitions fire at the threshold and only once", () => {
  assert.equal(shouldUnlock(false, 399, 400), false);
  assert.equal(shouldUnlock(false, 400, 400), true);
  assert.equal(shouldUnlock(false, 450, 400), true);
  assert.equal(shouldUnlock(true, 450, 400), false);
});

test("releasing a shoot pointer does not cancel a held jump pointer", () => {
  const pointers = createPointerInputState();
  assert.equal(pointers.press(1, "jump").becameActive, true);
  pointers.press(2, "shoot");
  pointers.press(3, "slide");
  assert.equal(pointers.isHeld("jump"), true);
  assert.equal(pointers.isHeld("slide"), true);

  pointers.release(2);
  assert.equal(pointers.isHeld("jump"), true);
  assert.equal(pointers.isHeld("slide"), true);

  pointers.release(1);
  assert.equal(pointers.isHeld("jump"), false);
  assert.equal(pointers.isHeld("slide"), true);
});

test("active run time excludes pause, tutorial, and game-over states", () => {
  let elapsed = 0;
  for (let i = 0; i < 60; i++) elapsed = advanceActiveRunTime(elapsed, "playing");
  for (let i = 0; i < 600; i++) elapsed = advanceActiveRunTime(elapsed, "paused");
  for (let i = 0; i < 120; i++) elapsed = advanceActiveRunTime(elapsed, "entering_initials");
  for (let i = 0; i < 30; i++) elapsed = advanceActiveRunTime(elapsed, "playing");
  assert.ok(Math.abs(elapsed - 90 * FIXED_STEP_MS) < 0.0001);
});

test("initials normalization allows only three uppercase letters", () => {
  assert.equal(normalizeInitials(" c-4hris "), "CHR");
  assert.equal(normalizeInitials("ab"), "AB");
});
