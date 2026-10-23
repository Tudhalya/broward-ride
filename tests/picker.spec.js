'use strict';

const { test, expect } = require('@playwright/test');

function route(num, name, dirs = ['North', 'South']) {
  const sname = String(num).padStart(2, '0');
  return dirs.map((dir) => ({ Id: `BCT${sname}_${dir}`, SName: sname, LName: name, GeoDirection: dir }));
}

// Enough routes that the list scrolls, with 109 (the app's default) not last so its header can reach the top
const ROUTES = [
  ...route(1,  'US 1 Local'),
  ...route(2,  'University Dr Local'),
  ...route(5,  'Pembroke Rd Local', ['East', 'West']),
  ...route(18, 'US 441 Local'),
  ...route(23, 'Pembroke Lakes Mall - Sawgrass Mills Mall'),
  ...Array.from({ length: 15 }, (_, i) => route(30 + i, `Crosstown ${String.fromCharCode(65 + i)}`)).flat(),
  ...route(108, '95 Express Pembroke Pines'),
  ...route(109, '95 Express Pembroke Pines/Miramar'),
  ...route(110, '595 Express BB&T Center to Miami/Brickell'),
  ...route(114, '595 Express BB&T Center to Miami Civic Center'),
  ...route(115, '75 Express Miramar P&R to Miami Intermodal Center'),
];

test.beforeEach(async ({ page }) => {
  // Stub the BCT proxy so runs are deterministic and never hit the upstream rate limit
  await page.route('**/api/**', (r) => {
    const { pathname } = new URL(r.request().url());
    const body = pathname === '/api/routes' ? ROUTES
      : pathname === '/api/config' ? { cartoApiKey: '' }
      : [];
    return r.fulfill({ json: body });
  });
  await page.route(/basemaps\.cartocdn\.com/, (r) => r.abort());

  await page.goto('/');
  await expect(page.locator('#route-btn')).toHaveText('109 - Northbound');
});

test('opens with the selected route header at the top of the list', async ({ page }) => {
  await page.locator('#route-btn').click();

  const list   = page.locator('#route-list');
  const offset = await list.evaluate((el) => {
    const header = el.querySelector('[aria-selected="true"]').parentElement.firstElementChild;
    return header.getBoundingClientRect().top - el.getBoundingClientRect().top;
  });
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(offset).toBeGreaterThanOrEqual(0);
  expect(offset).toBeLessThan(4);
});

test('autofocuses search only on wide screens', async ({ page }) => {
  await page.locator('#route-btn').click();

  const wide = page.viewportSize().width >= 768;
  await expect(page.locator(wide ? '#route-search' : '#route-list')).toBeFocused();
});

test('search filters routes by name and number', async ({ page }) => {
  await page.locator('#route-btn').click();
  const search = page.locator('#route-search');
  const labels = page.locator('.route-group:not([hidden]) .route-group-label');

  await search.fill('pembroke');
  await expect(labels).toHaveText([/^5 —/, /^23 —/, /^108 —/, /^109 —/]);

  await search.fill('18');
  await expect(labels).toHaveText([/^18 —/]);

  await search.fill('zzz');
  await expect(labels).toHaveCount(0);
  await expect(page.locator('#route-empty')).toBeVisible();
});

test('arrow keys and Enter pick a route', async ({ page }) => {
  await page.locator('#route-btn').click();
  await page.locator('#route-search').fill('pembroke rd');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  await expect(page.locator('#route-list')).toBeHidden();
  await expect(page.locator('#route-btn')).toHaveText('5 - Westbound');
  await expect(page.locator('#route-btn')).toBeFocused();
});

test('tapping an option picks it and Track applies it', async ({ page }) => {
  await page.locator('#route-btn').click();
  await page.locator('#route-search').fill('pembroke rd');
  await page.getByRole('option', { name: 'Eastbound' }).click();
  await expect(page.locator('#route-btn')).toHaveText('5 - Eastbound');

  await page.locator('#track-btn').click();
  await expect(page.locator('#status-text')).toHaveText('No buses found on route 5 East');
});

const closers = {
  'Escape':           (page) => page.keyboard.press('Escape'),
  'the arrow':        (page) => page.locator('#route-arrow').click(),
  // The header, because on short phones the open list covers the tabs and status bar
  'clicking outside': (page) => page.locator('.app-title').click(),
};

for (const [how, close] of Object.entries(closers)) {
  test(`${how} closes without changing the route`, async ({ page }) => {
    await page.locator('#route-btn').click();
    await page.locator('#route-search').fill('pembroke');
    await close(page);

    await expect(page.locator('#route-list')).toBeHidden();
    await expect(page.locator('#route-search')).toBeHidden();
    await expect(page.locator('#route-btn')).toHaveText('109 - Northbound');
  });
}
