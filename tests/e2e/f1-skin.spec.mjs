import { expect, test } from "@playwright/test";

const teams = [
  ["redbull", "Oracle Red Bull Racing"],
  ["ferrari", "Scuderia Ferrari"],
  ["mclaren", "McLaren Racing"],
  ["mercedes", "Mercedes-AMG Petronas Formula One Team"]
];

const box = async (locator) => {
  await expect(locator).toBeVisible();
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value;
};

const overlaps = (a, b) => !(
  a.x + a.width <= b.x || b.x + b.width <= a.x ||
  a.y + a.height <= b.y || b.y + b.height <= a.y
);

// The section is reached through DSH's own settings rail. Clicks are dispatched
// on the native controls directly: a blank CI profile mounts a mandatory setup
// layer, and this suite is scoped to plugin integration, not host onboarding.
const openF1Settings = async (page) => {
  const section = page.locator('.dsh-f1-settings[aria-label="Formula One 车队皮肤"]');
  if (await section.isVisible().catch(() => false)) return section;

  const settingsEntry = page.getByText("设置", { exact: true }).last();
  await expect(settingsEntry).toBeVisible();
  await settingsEntry.evaluate((element) => element.click());

  const f1Entry = page.getByText("Formula One 车队", { exact: true }).last();
  await expect(f1Entry).toBeVisible();
  await f1Entry.evaluate((element) => element.click());

  await expect(section).toBeVisible();
  return section;
};

const skinSheet = 'style[data-plugin-css="dsh-f1-skin/skin.css"]';
const settingsSheet = 'style[data-plugin-css="dsh-f1-skin/settings.css"]';
// The photograph layer is the skin's own `body::before`; asserting on its
// background keeps the check specific to this plugin.
const photoLayer = (page) => page.locator("body")
  .evaluate((body) => getComputedStyle(body, "::before").backgroundImage);
// Custom properties inherit, so probe the elements a theme token could reach the
// page through and report the first value that exists. Where the host keeps its
// tokens out of reach entirely this returns "", and the caller drops only the
// token assertions — the unit tests cover the token layer itself.
const brandToken = (page) => page.evaluate(() => {
  const candidates = [document.documentElement, document.body, ...Array.from(document.body.children).slice(0, 5)];
  for (const element of candidates) {
    const value = getComputedStyle(element).getPropertyValue("--dsw-alias-brand-primary").trim();
    if (value !== "") return value;
  }
  return "";
});

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-f1-team", /^(redbull|ferrari|mclaren|mercedes)$/);
  await expect(page.locator("html")).toHaveAttribute("data-f1-enabled", "true");
  await expect(page.locator(skinSheet)).toHaveCount(1);
  await expect(page.locator(settingsSheet)).toHaveCount(1);
});

for (const [id, name] of teams) {
  test(`${name} keeps identity and host controls readable`, async ({ page }, testInfo) => {
    await page.evaluate((teamId) => localStorage.setItem("dsh-f1-skin:team", teamId), id);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-f1-team", id);
    if (testInfo.project.name === "desktop-dark") {
      await expect(page.locator("html")).toHaveAttribute("data-f1-dark", "true");
    }

    if (testInfo.project.name === "compact") {
      const collapsedHarness = await page.locator(".hHd-Xa_logoRow").evaluate((row) =>
        getComputedStyle(row, "::after").content);
      expect(collapsedHarness).toContain("HARNESS");
    } else {
      const harness = page.locator(".hHd-Xa_brandName svg").first();
      const harnessBox = await box(harness);
      expect(harnessBox.width).toBeGreaterThan(140);
      expect(harnessBox.height).toBeGreaterThan(20);

      const nativeBrand = page.locator(".hHd-Xa_brand").first();
      const brandBox = await box(nativeBrand);
      expect(harnessBox.x).toBeGreaterThanOrEqual(brandBox.x - 1);
      expect(harnessBox.x + harnessBox.width).toBeLessThanOrEqual(brandBox.x + brandBox.width + 1);
    }

    const logoImage = await page.locator("html").evaluate((root) =>
      getComputedStyle(root).getPropertyValue("--f1-team-logo"));
    expect(logoImage).toContain("data:image/svg+xml;base64");

    const backgroundImage = await page.locator("html").evaluate((root) =>
      getComputedStyle(root).getPropertyValue("--f1-cockpit"));
    // Cockpit photographs are HTTP-served (no inlining cap) instead of data: URIs.
    expect(backgroundImage).toContain("/plugin-assets/dsh-f1-skin/");

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/\b(?:RBR|MCL|MER|FER)\s*0[1-4]\b|\bGARAGE\s*0[1-4]\b/i);

    await page.screenshot({
      path: testInfo.outputPath(`${id}-${testInfo.project.name}.png`),
      fullPage: true
    });
  });
}

test("settings remains above the composer and all four teams are operable", async ({ page }, testInfo) => {
  test.setTimeout(25_000);
  test.skip(testInfo.project.name === "compact", "The compact host layout intentionally collapses the settings rail.");

  const hasMandatoryHostLayer = await page
    .locator('[role="presentation"] > [aria-hidden="true"]:visible')
    .count() > 0;
  const section = await openF1Settings(page);

  const sectionBox = await box(section);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(sectionBox.x).toBeGreaterThanOrEqual(0);
  expect(sectionBox.y).toBeGreaterThanOrEqual(0);
  expect(sectionBox.x + sectionBox.width).toBeLessThanOrEqual(viewport.width + 1);

  for (const [id, name] of teams) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    await button.evaluate((element) => element.click());
    await expect(page.locator("html")).toHaveAttribute("data-f1-team", id);
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }

  const settingsText = await section.innerText();
  expect(settingsText).not.toMatch(/\b(?:RBR|MCL|MER|FER)\b|\b(?:01|02|03|04)\b/);

  if (!hasMandatoryHostLayer) {
    const center = { x: sectionBox.x + sectionBox.width / 2, y: sectionBox.y + Math.min(sectionBox.height / 2, 240) };
    const topElementBelongsToSettings = await page.evaluate(({ x, y }) => {
      const top = document.elementFromPoint(x, y);
      return Boolean(top?.closest(".dsh-f1-settings"));
    }, center);
    expect(topElementBelongsToSettings).toBeTruthy();

    const composer = page.locator(".uV2eYG_card").first();
    if (await composer.isVisible()) {
      const composerBox = await box(composer);
      if (overlaps(sectionBox, composerBox)) {
        const overlapCenter = {
          x: (Math.max(sectionBox.x, composerBox.x) + Math.min(sectionBox.x + sectionBox.width, composerBox.x + composerBox.width)) / 2,
          y: (Math.max(sectionBox.y, composerBox.y) + Math.min(sectionBox.y + sectionBox.height, composerBox.y + composerBox.height)) / 2
        };
        const composerIsBehindDialog = await page.evaluate(({ x, y }) =>
          Boolean(document.elementFromPoint(x, y)?.closest('[role="dialog"]')), overlapCenter);
        expect(composerIsBehindDialog).toBeTruthy();
      }
    }
  }
});

test("the official brand row keeps its mark inside the panel", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "compact", "The compact host layout intentionally collapses the rail.");

  const geometry = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const row = box(".hHd-Xa_logoRow");
    const mark = box(".hHd-Xa_brandMark svg");
    const name = box(".hHd-Xa_brandName svg");
    if (row === null || mark === null || name === null) return null;
    return {
      rowLeft: row.left,
      markLeft: mark.left,
      markRight: mark.right,
      markWidth: mark.width,
      nameLeft: name.left,
      nameWidth: name.width,
      overflow: getComputedStyle(document.querySelector(".hHd-Xa_brandName svg")).overflow
    };
  });
  // Not every supported host build splits the lockup into a slotted mark; the
  // stylesheet invariants in scripts/check.mjs cover those builds instead.
  test.skip(geometry === null, "this host build does not expose the slotted brand mark");

  // The row packs its children to the right, so a fixed-width brand overflows to
  // the left and drags the whale over the panel border and the accent bar.
  expect(geometry.markLeft).toBeGreaterThanOrEqual(geometry.rowLeft);
  expect(geometry.markWidth).toBeCloseTo(24, 0);
  expect(geometry.nameLeft).toBeGreaterThanOrEqual(geometry.markRight);
  expect(geometry.nameWidth).toBeCloseTo(156, 0);
  // DSH crops its own whale out of the wordmark SVG; un-clipping that viewport
  // paints a second copy of the mark over the slotted one.
  expect(geometry.overflow).toBe("hidden");
});

test("the master switch restores the native host and survives a reload", async ({ page }, testInfo) => {
  test.setTimeout(25_000);
  test.skip(testInfo.project.name === "compact", "The compact host layout intentionally collapses the settings rail.");

  const section = await openF1Settings(page);
  const toggle = page.getByRole("switch", { name: "启用 F1 车队皮肤" });
  await expect(toggle).toBeChecked();
  await expect(section).toHaveAttribute("data-f1-enabled", "true");
  await expect(section).toContainText("已启用");

  // Only asserted where the host exposes its tokens to the page; see brandToken.
  const enabledBrand = await brandToken(page);
  expect(await photoLayer(page)).toContain("dsh-f1-skin");

  await toggle.evaluate((element) => element.click());

  // The switch reports itself, the document, and the panel state at once.
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-f1-enabled", "false");
  await expect(section).toHaveAttribute("data-f1-enabled", "false");
  await expect(section).toContainText("已关闭");

  // Off means the skin stylesheet is gone, not overruled, while the settings
  // sheet stays mounted — the panel is the only way back.
  await expect(page.locator(skinSheet)).toHaveCount(0);
  await expect(page.locator(settingsSheet)).toHaveCount(1);
  expect(await photoLayer(page)).not.toContain("dsh-f1-skin");

  // The token layer is withdrawn too, so DSH's own brand colour is back.
  if (enabledBrand !== "") expect(await brandToken(page)).not.toBe(enabledBrand);

  // Every skin-only control is inert rather than silently ineffective.
  await expect(page.locator(".dsh-f1-team-card").first()).toBeDisabled();
  await expect(page.locator('.dsh-f1-setting input[type="range"]').first()).toBeDisabled();
  await expect(toggle).toBeEnabled();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-f1-enabled", "false");
  await expect(page.locator(skinSheet)).toHaveCount(0);
  await expect(page.locator(settingsSheet)).toHaveCount(1);

  const reopened = await openF1Settings(page);
  const restored = page.getByRole("switch", { name: "启用 F1 车队皮肤" });
  await expect(restored).not.toBeChecked();
  await restored.evaluate((element) => element.click());

  await expect(page.locator("html")).toHaveAttribute("data-f1-enabled", "true");
  await expect(reopened).toHaveAttribute("data-f1-enabled", "true");
  await expect(reopened).toContainText("已启用");
  await expect(restored).toBeChecked();
  await expect(page.locator(skinSheet)).toHaveCount(1);
  expect(await photoLayer(page)).toContain("dsh-f1-skin");
  if (enabledBrand !== "") expect(await brandToken(page)).toBe(enabledBrand);
});
