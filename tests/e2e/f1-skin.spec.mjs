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

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-f1-team", /^(redbull|ferrari|mclaren|mercedes)$/);
  await expect(page.locator('style[data-plugin="dsh-f1-skin"]')).toHaveCount(1);
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
  const settingsEntry = page.getByText("设置", { exact: true }).last();
  await expect(settingsEntry).toBeVisible();
  // A blank CI profile has a mandatory DSH setup layer. Trigger the native
  // rail controls directly so this test remains scoped to plugin integration.
  await settingsEntry.evaluate((element) => element.click());

  const f1Entry = page.getByText("Formula One 车队", { exact: true }).last();
  await expect(f1Entry).toBeVisible();
  await f1Entry.evaluate((element) => element.click());

  const section = page.locator('.dsh-f1-settings[aria-label="Formula One 车队皮肤"]');
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
