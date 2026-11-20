'use strict';

const { test, expect } = require('@playwright/test');

function route(num, name, dirs = ['North', 'South']) {
  const sname = String(num).padStart(2, '0');
  return dirs.map((dir) => ({ Id: `BCT${sname}_${dir}`, SName: sname, LName: name, GeoDirection: dir }));
}

// Enough routes after 109 (the app's default) that its header can reach the top even with wide fallback
// fonts, which make the list taller; otherwise the list hits its scroll limit and the test fails on CI only
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
  ...Array.from({ length: 8 }, (_, i) => route(200 + i, `Community Shuttle ${String.fromCharCode(65 + i)}`)).flat(),
];

async function chooseRoute(page, search, direction) {
  await page.locator('#route-btn').click();
  await page.locator('#route-search').fill(search);
  await page.getByRole('option', { name: direction }).click();
}

function recordPositionRequests(page) {
  const routes = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/positions') routes.push(url.searchParams.get('route'));
  });
  return routes;
}

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

test('list is as wide as the field, or wider on narrow screens', async ({ page }) => {
  await page.locator('#route-btn').click();

  const field = await page.locator('#route-search').boundingBox();
  const list  = await page.locator('#route-list').boundingBox();
  expect(list.x).toBeCloseTo(field.x, 0);
  if (field.width >= 360) expect(list.width).toBeCloseTo(field.width, 0);
  else expect(list.width).toBeGreaterThan(field.width);
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

test('arrow keys and Enter track a route automatically', async ({ page }) => {
  await page.locator('#route-btn').click();
  await page.locator('#route-search').fill('pembroke rd');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  await expect(page.locator('#route-list')).toBeHidden();
  await expect(page.locator('#route-btn')).toHaveText('5 - Westbound');
  await expect(page.locator('#route-btn')).toBeFocused();
  await expect(page.locator('#status-text')).toHaveText('No buses found on route 5 West');
});

test('tapping an option tracks the route automatically', async ({ page }) => {
  await chooseRoute(page, 'pembroke rd', 'Eastbound');
  await expect(page.locator('#route-btn')).toHaveText('5 - Eastbound');

  await expect(page.locator('#status-text')).toHaveText('No buses found on route 5 East');
  await expect(page.locator('#track-btn')).toBeDisabled();
});

test('cooldown queues only the latest route and shows the loading overlay', async ({ page }) => {
  await expect(page.locator('#status-text')).toHaveText('No buses found on route 109 North');
  await page.clock.install();
  const requests = recordPositionRequests(page);

  await page.locator('#track-btn').click();
  await expect(page.locator('#status-text')).toHaveText('No buses found on route 109 North');
  await chooseRoute(page, 'pembroke rd', 'Eastbound');
  await expect(page.getByRole('status')).toHaveText('Route 5 Eastbound queued');
  await chooseRoute(page, 'pembroke rd', 'Westbound');
  await expect(page.getByRole('status')).toHaveText('Route 5 Westbound queued');
  await expect(page.locator('#status-text')).toHaveText('No buses found on route 109 North');
  const overlay = page.locator('#loading-overlay');
  await expect(overlay).toHaveCSS('opacity', '1');
  await expect(overlay).toHaveCSS('pointer-events', 'all');
  expect(requests).toEqual(['BCT109_North']);

  await page.clock.runFor(5_000);
  await expect(page.locator('#status-text')).toHaveText('No buses found on route 5 West');
  await expect(page.getByRole('status')).toBeEmpty();
  expect(requests).toEqual(['BCT109_North', 'BCT05_West']);
});

test('choosing the currently tracked route cancels a queued switch', async ({ page }) => {
  const status = page.locator('#status-text');
  const track = page.locator('#track-btn');
  const queue = page.getByRole('status');
  await expect(status).toHaveText('No buses found on route 109 North');
  await page.clock.install();
  const requests = recordPositionRequests(page);

  await track.click();
  await chooseRoute(page, 'pembroke rd', 'Eastbound');
  await expect(queue).toHaveText('Route 5 Eastbound queued');

  await chooseRoute(page, '109', 'Northbound');
  await expect(queue).toBeEmpty();
  await expect(track).toBeDisabled();

  await page.clock.runFor(5_000);
  await expect(track).toBeEnabled();
  await expect(status).toHaveText('No buses found on route 109 North');
  await expect(page.locator('#loading-overlay')).not.toHaveClass(/show/);
  expect(requests).toEqual(['BCT109_North']);
});

test('loading stays visible while a queued route waits for the active refresh', async ({ page }) => {
  const status = page.locator('#status-text');
  const track = page.locator('#track-btn');
  const queue = page.getByRole('status');
  const overlay = page.locator('#loading-overlay');
  await expect(status).toHaveText('No buses found on route 109 North');
  await page.clock.install();
  const requests = recordPositionRequests(page);

  const heldRequests = new Map();
  await page.route('**/api/positions?*', (route) => {
    const key = new URL(route.request().url()).searchParams.get('route');
    heldRequests.set(key, route);
  });

  await track.click();
  await expect.poll(() => heldRequests.has('BCT109_North')).toBe(true);
  await expect(overlay).toHaveCSS('pointer-events', 'all');
  await chooseRoute(page, 'pembroke rd', 'Eastbound');
  await expect(queue).toHaveText('Route 5 Eastbound queued');
  await expect(overlay).toHaveCSS('opacity', '1');
  await expect(overlay).toHaveCSS('pointer-events', 'all');

  await page.clock.runFor(5_000);
  await expect(track).toBeEnabled();
  await expect(queue).toHaveText('Route 5 Eastbound queued');
  expect(requests).toEqual(['BCT109_North']);

  await heldRequests.get('BCT109_North').fulfill({ json: [] });
  await expect.poll(() => heldRequests.has('BCT05_East')).toBe(true);
  await expect(queue).toBeEmpty();
  await expect(overlay).toHaveClass(/show/);
  await expect(overlay).toHaveCSS('pointer-events', 'all');

  await heldRequests.get('BCT05_East').fulfill({ json: [] });
  await expect(status).toHaveText('No buses found on route 5 East');
  await expect(overlay).not.toHaveClass(/show/);
  expect(requests).toEqual(['BCT109_North', 'BCT05_East']);
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
