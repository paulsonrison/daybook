import { test, expect } from '@playwright/test';

for (const mode of ['dark', 'system']) {
  test(`${mode}: recovery descriptions remain readable`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`/tests/browser/?mode=${mode}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('.db-notification-description')).toHaveCount(4);
    const ratios = await page
      .locator('.db-notification-description')
      .evaluateAll((nodes) => {
        const luminance = (color: string) => {
          const rgb = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((n) => {
              const v = n / 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        return nodes.map((node) => {
          const text = luminance(getComputedStyle(node).color);
          const background = luminance(
            getComputedStyle(node.closest('.db-notification')!).backgroundColor,
          );
          return (
            (Math.max(text, background) + 0.05) /
            (Math.min(text, background) + 0.05)
          );
        });
      });
    expect(ratios).toHaveLength(4);
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
}

test('tooltip remains open across its gap and while hovered, then Escape dismisses', async ({
  page,
}) => {
  await page.goto('/tests/browser/');
  await page.getByRole('button', { name: 'Explain' }).hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  const box = await tip.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, {
    steps: 4,
  });
  await expect(tip).toBeVisible();
  await expect(tip).toHaveCSS('pointer-events', 'auto');
  await page.waitForTimeout(350);
  await expect(tip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
});
