const { test, expect } = require("@playwright/test");

test("keyboard-only play, pause, resume, and quit preserve normal Tab navigation", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");

  const startButton = page.locator("#start-btn");
  const canvas = page.locator("#gameCanvas");
  await expect(startButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#start-screen")).toBeHidden();
  await expect(canvas).toBeFocused();

  await page.keyboard.press("Space");
  await page.keyboard.press("KeyX");
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-screen")).toBeVisible();
  await expect(page.locator("#resume-btn")).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.locator("#quit-btn")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(page.locator("#pause-screen")).toBeHidden();
  await expect(canvas).toBeFocused();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.locator("#start-screen")).toBeVisible();
  await expect(startButton).toBeFocused();
  expect(pageErrors).toEqual([]);
});

test("reduced motion and 200% zoom retain usable controls", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });

  await expect(page.locator("#start-btn")).toBeVisible();
  const animationDuration = await page.locator("#start-screen").evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).animationDuration),
  );
  expect(animationDuration).toBeLessThanOrEqual(0.001);
});

test("keyboard initials entry and death explanation complete the game-over flow", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.4; });
  await page.goto("/");
  await page.keyboard.press("Enter");

  const initialsInput = page.locator("#initials-input");
  await expect(initialsInput).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#initials-death-reason")).toHaveText("Clipped a street bollard");
  await initialsInput.fill("abc");
  await page.keyboard.press("Enter");

  await expect(page.locator("#game-over-screen")).toBeVisible();
  await expect(page.locator("#death-reason")).toHaveText("Clipped a street bollard");
  await expect(page.locator("#restart-btn")).toBeFocused();
});

test("portrait touch play remains available and accepts simultaneous pointers", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("http://127.0.0.1:4173/");

  await expect(page.locator("#rotate-prompt")).toBeVisible();
  await expect(page.locator("#start-btn")).toBeVisible();
  const containerStyle = await page.locator("#game-container").evaluate((element) => ({
    opacity: getComputedStyle(element).opacity,
    pointerEvents: getComputedStyle(element).pointerEvents,
  }));
  expect(containerStyle).toEqual({ opacity: "1", pointerEvents: "auto" });
  await page.locator("#start-btn").tap();

  await page.locator("#gameCanvas").evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    const dispatch = (type, pointerId, xRatio, yRatio) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width * xRatio,
      clientY: rect.top + rect.height * yRatio,
      pointerId,
      pointerType: "touch",
    }));
    dispatch("pointerdown", 1, 0.2, 0.25);
    dispatch("pointerdown", 2, 0.85, 0.5);
    dispatch("pointerup", 2, 0.85, 0.5);
    dispatch("pointerup", 1, 0.2, 0.25);
  });

  await expect(page.locator("#pause-btn-mobile")).toBeVisible();
  expect(pageErrors).toEqual([]);
  await context.close();
});
