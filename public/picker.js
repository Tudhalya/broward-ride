import { DIR_LABEL, SEARCH_AUTOFOCUS_MQ } from './config.js';
import { state } from './state.js';

let activeOpt = null;

function dirLabel(route) { return DIR_LABEL[route.GeoDirection] || route.GeoDirection; }

export function populateRoutePicker() {
  const list = document.getElementById('route-list');
  list.innerHTML = '';

  const groups = {};
  state.routes.forEach((r) => {
    (groups[r.SName] = groups[r.SName] || []).push(r);
  });

  Object.keys(groups)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((num) => {
      const routes = groups[num];
      const grp    = document.createElement('div');
      const label  = document.createElement('div');
      grp.className      = 'route-group';
      grp.dataset.search = `${Number(num)} ${routes[0].LName}`.toLowerCase();
      grp.setAttribute('role', 'group');
      label.className   = 'route-group-label';
      label.id          = `route-group-${num}`;
      label.textContent = `${Number(num)} — ${routes[0].LName}`;
      grp.setAttribute('aria-labelledby', label.id);
      grp.appendChild(label);

      routes.forEach((r) => {
        const opt = document.createElement('div');
        opt.className     = 'route-option';
        opt.id            = `route-opt-${r.Id}`;
        opt.dataset.value = r.Id;
        opt.textContent   = dirLabel(r);
        opt.setAttribute('role', 'option');
        grp.appendChild(opt);
      });
      list.appendChild(grp);
    });

  const empty = document.createElement('p');
  empty.className   = 'hint';
  empty.id          = 'route-empty';
  empty.textContent = 'No matching routes';
  empty.hidden      = true;
  list.appendChild(empty);

  selectRoute(state.routeKey);
}

function selectRoute(key) {
  const route = state.routes.find((r) => r.Id === key);
  if (!route) return;
  const btn = document.getElementById('route-btn');
  btn.dataset.value = key;
  btn.textContent   = `${Number(route.SName)} - ${dirLabel(route)}`;
  document.querySelectorAll('#route-list .route-option').forEach((o) => {
    o.setAttribute('aria-selected', String(o.dataset.value === key));
  });
}

function visibleOptions() {
  return [...document.querySelectorAll('#route-list .route-group:not([hidden]) .route-option')];
}

function setActive(opt) {
  const list   = document.getElementById('route-list');
  const search = document.getElementById('route-search');
  activeOpt?.classList.remove('active');
  activeOpt = opt;
  if (!opt) {
    list.removeAttribute('aria-activedescendant');
    search.removeAttribute('aria-activedescendant');
    return;
  }
  opt.classList.add('active');
  list.setAttribute('aria-activedescendant', opt.id);
  search.setAttribute('aria-activedescendant', opt.id);
  if (opt.offsetTop < list.scrollTop) {
    list.scrollTop = opt.offsetTop;
  } else if (opt.offsetTop + opt.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTop = opt.offsetTop + opt.offsetHeight - list.clientHeight;
  }
}

function filterRoutes() {
  const list  = document.getElementById('route-list');
  const query = document.getElementById('route-search').value.trim().toLowerCase();
  list.querySelectorAll('.route-group').forEach((g) => {
    g.hidden = !g.dataset.search.includes(query);
  });
  const first = visibleOptions()[0];
  document.getElementById('route-empty').hidden = Boolean(first);
  list.scrollTop = 0;
  setActive(first);
}

function openPicker() {
  const btn    = document.getElementById('route-btn');
  const list   = document.getElementById('route-list');
  const search = document.getElementById('route-search');
  if (!list.querySelector('.route-option')) return;

  search.value = '';
  filterRoutes();
  btn.hidden    = true;
  btn.setAttribute('aria-expanded', 'true');
  search.hidden = false;
  list.hidden   = false;

  // scrollIntoView() would also scroll the overflow:hidden page, so set scrollTop directly
  const selected = list.querySelector('[aria-selected="true"]');
  list.scrollTop = selected ? selected.parentElement.offsetTop : 0;
  setActive(selected || visibleOptions()[0]);

  // On narrow screens the on-screen keyboard would cover the list, so wait for a tap on the search box
  (matchMedia(SEARCH_AUTOFOCUS_MQ).matches ? search : list).focus();
}

function closePicker(refocus = true) {
  const list = document.getElementById('route-list');
  if (list.hidden) return;
  list.hidden = true;
  document.getElementById('route-search').hidden = true;
  setActive(null);
  const btn = document.getElementById('route-btn');
  btn.hidden = false;
  btn.setAttribute('aria-expanded', 'false');
  if (refocus) btn.focus();
}

function choose(opt) {
  selectRoute(opt.dataset.value);
  closePicker();
}

function onPickerKeydown(e) {
  const inSearch = e.target.id === 'route-search';
  if (inSearch && (e.key === ' ' || e.key === 'Home' || e.key === 'End')) return;

  const opts = visibleOptions();
  const i    = opts.indexOf(activeOpt);
  switch (e.key) {
    case 'ArrowDown': setActive(opts[Math.min(i + 1, opts.length - 1)]); break;
    case 'ArrowUp':   setActive(opts[Math.max(i - 1, 0)]); break;
    case 'Home':      setActive(opts[0]); break;
    case 'End':       setActive(opts[opts.length - 1]); break;
    case 'Enter':
    case ' ':         if (activeOpt) choose(activeOpt); break;
    case 'Escape':    closePicker(); break;
    case 'Tab':       closePicker(false); return;
    default:          return;
  }
  e.preventDefault();
}

export function initRoutePicker() {
  const btn    = document.getElementById('route-btn');
  const list   = document.getElementById('route-list');
  const search = document.getElementById('route-search');

  btn.addEventListener('click', openPicker);
  document.getElementById('route-arrow').addEventListener('click', () => (list.hidden ? openPicker() : closePicker()));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openPicker();
    }
  });

  search.addEventListener('input', filterRoutes);
  search.addEventListener('keydown', onPickerKeydown);
  list.addEventListener('keydown', onPickerKeydown);

  list.addEventListener('click', (e) => {
    const opt = e.target.closest('.route-option');
    if (opt) choose(opt);
  });

  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.route-picker')) closePicker(false);
  });
}
