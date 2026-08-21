(function initNeonSprintCore(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.NeonSprintCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createNeonSprintCore() {
  "use strict";

  const FIXED_STEP_MS = 1000 / 60;
  const MAX_FRAME_DELTA_MS = 250;

  function createFixedStepClock({
    stepMs = FIXED_STEP_MS,
    maxFrameDeltaMs = MAX_FRAME_DELTA_MS,
  } = {}) {
    let lastTimestamp = null;
    let accumulator = 0;

    return {
      advance(timestamp, onStep) {
        if (!Number.isFinite(timestamp)) {
          throw new TypeError("timestamp must be a finite number");
        }
        if (typeof onStep !== "function") {
          throw new TypeError("onStep must be a function");
        }

        if (lastTimestamp === null) {
          lastTimestamp = timestamp;
          return { steps: 0, alpha: 0 };
        }

        const elapsed = Math.min(
          maxFrameDeltaMs,
          Math.max(0, timestamp - lastTimestamp),
        );
        lastTimestamp = timestamp;
        accumulator += elapsed;

        let steps = 0;
        const maxSteps = Math.ceil(maxFrameDeltaMs / stepMs);
        const epsilon = stepMs * 1e-9;
        while (accumulator + epsilon >= stepMs && steps < maxSteps) {
          onStep(stepMs);
          accumulator -= stepMs;
          if (accumulator < 0 && accumulator > -epsilon) accumulator = 0;
          steps++;
        }

        return { steps, alpha: accumulator / stepMs };
      },

      reset(timestamp = null) {
        lastTimestamp = Number.isFinite(timestamp) ? timestamp : null;
        accumulator = 0;
      },
    };
  }

  function createPointerInputState() {
    const pointerActions = new Map();
    const actionCounts = new Map();

    function release(pointerId) {
      const action = pointerActions.get(pointerId);
      if (!action) return null;

      pointerActions.delete(pointerId);
      const nextCount = Math.max(0, (actionCounts.get(action) || 1) - 1);
      if (nextCount === 0) actionCounts.delete(action);
      else actionCounts.set(action, nextCount);
      return action;
    }

    return {
      press(pointerId, action) {
        release(pointerId);
        const previousCount = actionCounts.get(action) || 0;
        pointerActions.set(pointerId, action);
        actionCounts.set(action, previousCount + 1);
        return { action, becameActive: previousCount === 0 };
      },

      release,

      isHeld(action) {
        return (actionCounts.get(action) || 0) > 0;
      },

      clear() {
        pointerActions.clear();
        actionCounts.clear();
      },

      get size() {
        return pointerActions.size;
      },
    };
  }

  function rectanglesOverlap(a, b) {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  function shouldUnlock(alreadyUnlocked, currentScore, threshold) {
    return !alreadyUnlocked && currentScore >= threshold;
  }

  function advanceActiveRunTime(currentMs, state, stepMs = FIXED_STEP_MS) {
    return state === "playing" ? currentMs + stepMs : currentMs;
  }

  function advanceScore(currentScore, gameSpeed) {
    return currentScore + gameSpeed * 0.05;
  }

  function normalizeInitials(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 3);
  }

  return {
    FIXED_STEP_MS,
    MAX_FRAME_DELTA_MS,
    advanceActiveRunTime,
    advanceScore,
    createFixedStepClock,
    createPointerInputState,
    normalizeInitials,
    rectanglesOverlap,
    shouldUnlock,
  };
});
