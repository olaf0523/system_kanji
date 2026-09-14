/* ============================================================
   System Kanji Directory
   ============================================================ */

const BATCH_SIZE = 36;
const STORAGE_KEY = 'system-kanji-flags';
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  companies: [],
  filtered: [],
  rendered: 0,
  query: '',
  area: 'all',
  sort: 'default',
  flag: 'all',
  flags: loadFlags(),
  advanced: { mode: 'and', includeUnknown: false, conditions: [] },
  activeFields: new Set(),
  unknownCounts: {},
};

const el = {
  grid: document.querySelector('#companyGrid'),
  sentinel: document.querySelector('#sentinel'),
  search: document.querySelector('#searchInput'),
  area: document.querySelector('#areaSelect'),
  sort: document.querySelector('#sortSelect'),
  resultCount: document.querySelector('#resultCount'),
  status: document.querySelector('#statusMessage'),
  reset: document.querySelector('#resetButton'),
  chips: [...document.querySelectorAll('[data-flag-filter]')],
  chipCount1: document.querySelector('#chipCount1'),
  chipCount2: document.querySelector('#chipCount2'),
  modal: document.querySelector('#companyModal'),
  progress: document.querySelector('#scrollProgress'),
  header: document.querySelector('#siteHeader'),
  toTop: document.querySelector('#toTop'),
  advancedButton: document.querySelector('#advancedButton'),
  advancedCount: document.querySelector('#advancedCount'),
  activeConditions: document.querySelector('#activeConditions'),
  drawer: document.querySelector('#searchDrawer'),
  conditionList: document.querySelector('#conditionList'),
  addCondition: document.querySelector('#addCondition'),
  includeUnknown: document.querySelector('#includeUnknown'),
  drawerCount: document.querySelector('#drawerCount'),
  drawerTotal: document.querySelector('#drawerTotal'),
  drawerNote: document.querySelector('#drawerNote'),
  clearConditions: document.querySelector('#clearConditions'),
  modeButtons: [...document.querySelectorAll('.segmented [data-mode]')],
};

/* ------------------------------------------------------------
   CSV
   ------------------------------------------------------------ */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  const headers = rows.shift().map((header) => header.replace(/^﻿/, '').trim());
  return rows
    .filter((item) => item.some(Boolean))
    .map((item) => Object.fromEntries(headers.map((header, index) => [header, (item[index] || '').trim()])));
}

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
/* 47 prefectures, longest-first so 鹿児島県 wins over 島根県-style partial hits. */
const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県',
  '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県',
  '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];
const PREFECTURE_PATTERN = new RegExp(PREFECTURES.slice().sort((a, b) => b.length - a.length).join('|'));

/* Official north-to-south order; catch-all buckets always sort last. */
const TRAILING_AREAS = ['その他', '海外', '未登録'];
const areaRank = (area) => {
  const index = PREFECTURES.indexOf(area);
  return index === -1 ? PREFECTURES.length + TRAILING_AREAS.indexOf(area) : index;
};

/* Many records start at the city or ward, with no prefecture in the string. */
const CITY_TO_PREFECTURE = {
  札幌市: '北海道', 青森市: '青森県', 八戸市: '青森県', 盛岡市: '岩手県', 仙台市: '宮城県',
  秋田市: '秋田県', 山形市: '山形県', 福島市: '福島県', 水戸市: '茨城県', 宇都宮市: '栃木県',
  前橋市: '群馬県', さいたま市: '埼玉県', 千葉市: '千葉県', 横浜市: '神奈川県', 川崎市: '神奈川県',
  相模原市: '神奈川県', 新潟市: '新潟県', 富山市: '富山県', 金沢市: '石川県', 福井市: '福井県',
  甲府市: '山梨県', 長野市: '長野県', 岐阜市: '岐阜県', 静岡市: '静岡県', 浜松市: '静岡県',
  名古屋市: '愛知県', 津市: '三重県', 大津市: '滋賀県', 京都市: '京都府', 大阪市: '大阪府',
  堺市: '大阪府', 神戸市: '兵庫県', 姫路市: '兵庫県', 尼崎市: '兵庫県', 奈良市: '奈良県',
  和歌山市: '和歌山県', 鳥取市: '鳥取県', 松江市: '島根県', 岡山市: '岡山県', 広島市: '広島県',
  山口市: '山口県', 徳島市: '徳島県', 高松市: '香川県', 松山市: '愛媛県', 高知市: '高知県',
  福岡市: '福岡県', 北九州市: '福岡県', 佐賀市: '佐賀県', 長崎市: '長崎県', 熊本市: '熊本県',
  大分市: '大分県', 宮崎市: '宮崎県', 鹿児島市: '鹿児島県', 那覇市: '沖縄県',
};
const TOKYO_WARDS = /(千代田|中央|港|新宿|文京|台東|墨田|江東|品川|目黒|大田|世田谷|渋谷|中野|杉並|豊島|北|荒川|板橋|練馬|足立|葛飾|江戸川)区/;
const CITY_PATTERN = new RegExp(Object.keys(CITY_TO_PREFECTURE).sort((a, b) => b.length - a.length).join('|'));
const OVERSEAS_PATTERN = /ハノイ|ホーチミン|ダナン|ベトナム|上海|北京|大連|深圳|台北|ソウル|シンガポール|バンコク|マニラ|ヤンゴン/;

/* Normalises width/radical variants (⼤阪 -> 大阪) and strips zero-width junk. */
function normalizeLocation(location) {
  return (location || '').normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g, '').trim();
}

function getArea(location) {
  const text = normalizeLocation(location);
  if (!text) return '未登録';

  const prefecture = text.match(PREFECTURE_PATTERN);
  if (prefecture) return prefecture[0];

  const city = text.match(CITY_PATTERN);
  if (city) return CITY_TO_PREFECTURE[city[0]];

  if (TOKYO_WARDS.test(text)) return '東京都';
  if (OVERSEAS_PATTERN.test(text) || !/[\u4e00-\u9fff]/.test(text)) return '海外';
  return 'その他';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

function shortLocation(location) {
  return normalizeLocation(location).replace(/^〒\s*[\d-]+\s*/, '') || '所在地未登録';
}

/* Private windows and blocked site data make localStorage throw on access. */
const STORAGE_AVAILABLE = (() => {
  try {
    const probe = `${STORAGE_KEY}:probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
})();

const CHOICE_MARK = { 1: '\u2460', 2: '\u2461' };

/*
 * An entry is { choice, previous }. `choice` is the live selection and drives
 * the card colour; `previous` remembers it while the toggle is off, so the
 * button can put the selection back.
 */
function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;

  /* Migrate the old two-checkbox shape: both-checked used to read as green. */
  if ('first' in raw || 'second' in raw) {
    const migrated = raw.second ? '2' : raw.first ? '1' : null;
    return migrated ? { choice: migrated, previous: migrated } : null;
  }

  const choice = raw.choice === '1' || raw.choice === '2' ? raw.choice : null;
  const previous = raw.previous === '1' || raw.previous === '2' ? raw.previous : choice;
  return choice || previous ? { choice, previous } : null;
}

function loadFlags() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    /* Guard against a hand-edited or half-written value. */
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored)
        .map(([key, value]) => [key, normalizeEntry(value)])
        .filter(([, value]) => value),
    );
  } catch {
    return {};
  }
}

function saveFlags() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.flags));
  } catch {
    warnStorage();
  }
}

/* Tell the user once, rather than dropping their selections quietly. */
let storageWarned = false;
function warnStorage() {
  if (storageWarned) return;
  storageWarned = true;
  const notice = document.querySelector('#storageNotice');
  notice.textContent = '⚠ この端末では選択を保存できません（セッション中のみ保持されます）';
  notice.hidden = false;
}

function flagOf(company) {
  return (state.flags[company.key] || {}).choice || '';
}

/* Sets the live selection; passing null turns it off but keeps it remembered. */
function setChoice(company, choice) {
  const entry = state.flags[company.key] || {};
  if (choice) {
    entry.choice = choice;
    entry.previous = choice;
  } else {
    entry.previous = entry.choice || entry.previous || null;
    entry.choice = null;
  }
  if (!entry.choice && !entry.previous) delete state.flags[company.key];
  else state.flags[company.key] = entry;
  saveFlags();
}

/* ------------------------------------------------------------
   Count-up animation
   ------------------------------------------------------------ */
function countUp(node, target) {
  if (REDUCED_MOTION) {
    node.textContent = target.toLocaleString('en-US');
    return;
  }
  const duration = 1400;
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 4);
    node.textContent = Math.round(target * eased).toLocaleString('en-US');
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------
   Reveal observer (cards fade in as they enter the viewport)
   ------------------------------------------------------------ */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-in');
    revealObserver.unobserve(entry.target);
  });
}, { rootMargin: '80px 0px', threshold: 0.05 });

function observeReveals(scope = document) {
  scope.querySelectorAll('.reveal:not(.is-in)').forEach((node) => revealObserver.observe(node));
}

/* ------------------------------------------------------------
   Rendering
   ------------------------------------------------------------ */
function toggleLabel(entry, flag) {
  if (flag) return 'ON';
  return entry.previous ? `${CHOICE_MARK[entry.previous]} OFF` : 'OFF';
}

/* Single source of truth for a card's selection UI. */
function paintCard(card, company) {
  const flag = flagOf(company);
  const entry = state.flags[company.key] || {};

  if (flag) card.dataset.flag = flag;
  else delete card.dataset.flag;

  card.querySelectorAll('input[type="radio"]').forEach((radio) => {
    radio.checked = radio.value === flag;
  });

  const toggle = card.querySelector('[data-toggle]');
  toggle.disabled = !flag && !entry.previous;
  toggle.setAttribute('aria-pressed', String(Boolean(flag)));
  toggle.textContent = toggleLabel(entry, flag);
}

function cardMarkup(company, position, delay) {
  const flag = flagOf(company);
  const flagAttribute = flag ? ` data-flag="${flag}"` : '';
  const entry = state.flags[company.key] || {};

  return `
    <article class="company-card reveal" tabindex="0" role="button" data-id="${company.id}"${flagAttribute}
             style="--reveal-delay:${delay}ms" aria-label="${escapeHtml(company.company_name)}の詳細を開く">
      <div class="flex items-start justify-between gap-4">
        <span class="font-mono text-[11px] text-orange">${String(position).padStart(3, '0')}</span>
        <span class="bg-mint-wash px-2 py-1 font-mono text-[10px] whitespace-nowrap text-green">${escapeHtml(company.area)}</span>
      </div>

      <div class="relative z-10 mt-4 flex items-center gap-2" data-flags
           role="radiogroup" aria-label="${escapeHtml(company.company_name)}の選択">
        <label class="flag-box" data-choice="1">
          <input type="radio" name="flag-${company.id}" value="1" ${flag === '1' ? 'checked' : ''} /><span>①</span>
        </label>
        <label class="flag-box" data-choice="2">
          <input type="radio" name="flag-${company.id}" value="2" ${flag === '2' ? 'checked' : ''} /><span>②</span>
        </label>
        <button type="button" class="flag-toggle" data-toggle aria-pressed="${Boolean(flag)}"
                ${flag || entry.previous ? '' : 'disabled'}>${toggleLabel(entry, flag)}</button>
      </div>

      <h3 class="relative z-10 mt-5 text-[19px] leading-snug font-bold tracking-[-0.04em]">
        <span class="card-title">${escapeHtml(company.company_name || '社名未登録')}</span>
      </h3>
      <p class="relative z-10 mt-2.5 line-clamp-2 text-[12px] leading-relaxed text-muted">${escapeHtml(shortLocation(company.location))}</p>

      <dl class="relative z-10 mt-4 grid grid-cols-3 gap-3 border-t border-line/70 pt-3">
        ${[['capital', '資本金'], ['members', '社員数'], ['established', '設立']].map(([key, label]) => `
          <div class="min-w-0">
            <dt class="font-mono text-[9px] tracking-[0.12em] text-muted">${label}</dt>
            <dd class="mt-1 truncate text-[12px] font-semibold ${state.activeFields.has(key) ? 'text-orange' : 'text-ink'}">${SKSearch.formatValue(key, company.search[key])}</dd>
          </div>`).join('')}
      </dl>

      <div class="relative z-10 mt-auto flex items-end justify-between gap-4 pt-6">
        <span class="font-mono text-[12px] font-medium text-green">${escapeHtml(company.projects)} PROJECTS</span>
        <span class="flex items-center gap-1.5 text-[12px] text-orange">詳細を見る <span class="card-arrow">→</span></span>
      </div>
    </article>`;
}

function renderBatch() {
  const slice = state.filtered.slice(state.rendered, state.rendered + BATCH_SIZE);
  if (!slice.length) return;

  const markup = slice
    .map((company, index) => cardMarkup(company, state.rendered + index + 1, REDUCED_MOTION ? 0 : Math.min(index * 26, 420)))
    .join('');

  el.grid.insertAdjacentHTML('beforeend', markup);
  state.rendered += slice.length;
  observeReveals(el.grid);
  updateSentinel();
}

function updateSentinel() {
  const remaining = state.filtered.length - state.rendered;
  el.sentinel.textContent = remaining > 0 ? `LOADING ${remaining.toLocaleString('en-US')} MORE…` : '';
  el.sentinel.classList.toggle('animate-[shimmer_1.6s_ease-in-out_infinite]', remaining > 0);
}

function compareNullableDesc(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function render({ scrollToTop = false } = {}) {
  const query = state.query.trim();
  const items = conditionItems();
  const ready = items.filter((item) => item.compiled.ready).map((item) => item.compiled);
  const { mode, includeUnknown } = state.advanced;
  state.activeFields = new Set(ready.map((compiled) => compiled.field));

  state.filtered = state.companies.filter((company) => {
    if (state.area !== 'all' && company.area !== state.area) return false;
    if (state.flag !== 'all' && flagOf(company) !== state.flag) return false;
    if (query && !SKSearch.matchKeywords(company.search, query)) return false;
    return SKSearch.matchAll(company.search, ready, mode, includeUnknown);
  });

  if (state.sort === 'projects') {
    state.filtered.sort((a, b) => b.projectCount - a.projectCount);
  } else if (state.sort === 'name') {
    state.filtered.sort((a, b) => a.company_name.localeCompare(b.company_name, 'ja'));
  } else if (state.sort === 'capital' || state.sort === 'members' || state.sort === 'established') {
    state.filtered.sort((a, b) => compareNullableDesc(a.search[state.sort], b.search[state.sort]));
  } else if (state.sort === 'area') {
    state.filtered.sort((a, b) => (
      areaRank(a.area) - areaRank(b.area)
      || a.company_name.localeCompare(b.company_name, 'ja')
    ));
  }

  state.rendered = 0;
  el.grid.innerHTML = '';

  const isFiltered = Boolean(query) || state.area !== 'all' || state.flag !== 'all' || ready.length > 0;
  el.resultCount.textContent = `${state.filtered.length.toLocaleString('en-US')} / ${state.companies.length.toLocaleString('en-US')} COMPANIES`;
  el.status.textContent = isFiltered ? 'FILTERED VIEW' : '';
  el.reset.classList.toggle('opacity-0', !isFiltered);
  el.reset.classList.toggle('opacity-100', isFiltered);
  el.reset.setAttribute('aria-hidden', String(!isFiltered));
  el.reset.tabIndex = isFiltered ? 0 : -1;
  renderAdvancedSummary(items);

  if (!state.filtered.length) {
    el.grid.innerHTML = `
      <div class="col-span-full animate-[pop_0.42s_var(--ease-spring)_both] border border-dashed border-line px-6 py-20 text-center">
        <p class="font-mono text-[11px] tracking-[0.12em] text-orange">NO MATCH</p>
        <p class="mt-3 text-[14px] text-muted">条件に一致する会社が見つかりませんでした。</p>
        <button type="button" class="chip mt-6" data-reset>条件をリセット ×</button>
      </div>`;
    updateSentinel();
    return;
  }

  renderBatch();
  if (scrollToTop) {
    const top = document.querySelector('#directory').getBoundingClientRect().top + window.scrollY - 90;
    if (window.scrollY > top) window.scrollTo({ top, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
  }
}

function updateChipCounts() {
  const values = Object.values(state.flags);
  el.chipCount1.textContent = values.filter((entry) => entry.choice === '1').length;
  el.chipCount2.textContent = values.filter((entry) => entry.choice === '2').length;
}

/* ------------------------------------------------------------
   Modal
   ------------------------------------------------------------ */
const modalFields = {
  modalCapital: 'capital',
  modalEstablishment: 'establishment_year',
  modalMembers: 'number_of_members',
  modalRepresentative: 'representative',
};

function openCompany(company) {
  document.querySelector('#modalCompanyName').textContent = company.company_name || '社名未登録';
  document.querySelector('#modalLocation').textContent = shortLocation(company.location);
  document.querySelector('#modalProjects').textContent = `${company.projects} PROJECTS`;

  Object.entries(modalFields).forEach(([id, key]) => {
    document.querySelector(`#${id}`).textContent = company[key] || '未登録';
  });

  const website = document.querySelector('#modalWebsite');
  const hasWebsite = /^https?:\/\//.test(company.company_website);
  website.href = hasWebsite ? company.company_website : '#';
  website.classList.toggle('pointer-events-none', !hasWebsite);
  website.classList.toggle('opacity-40', !hasWebsite);
  website.textContent = hasWebsite ? '公式サイト ↗' : '公式サイト未登録';

  document.querySelector('#modalProfile').href = company.system_kanji_profile_link;

  el.modal.showModal();
  document.body.style.overflow = 'hidden';
}

el.modal.addEventListener('close', () => {
  document.body.style.overflow = '';
});
el.modal.addEventListener('click', (event) => {
  if (event.target === el.modal) el.modal.close();
});
document.querySelector('#modalClose').addEventListener('click', () => el.modal.close());

/* ------------------------------------------------------------
   Events
   ------------------------------------------------------------ */
el.grid.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-toggle]');
  if (toggle) {
    const card = toggle.closest('.company-card');
    const company = state.companies[Number(card.dataset.id)];
    const entry = state.flags[company.key] || {};
    /* On -> off, then off -> back to whatever was chosen before. */
    setChoice(company, flagOf(company) ? null : entry.previous);
    paintCard(card, company);
    updateChipCounts();
    if (state.flag !== 'all') render();
    return;
  }
  if (event.target.closest('[data-flags]')) return;
  if (event.target.closest('[data-reset]')) {
    resetFilters();
    return;
  }
  const card = event.target.closest('.company-card');
  if (card) openCompany(state.companies[Number(card.dataset.id)]);
});

el.grid.addEventListener('keydown', (event) => {
  const card = event.target.closest('.company-card');
  if (!card || event.target !== card) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openCompany(state.companies[Number(card.dataset.id)]);
  }
});

el.grid.addEventListener('change', (event) => {
  const radio = event.target.closest('input[type="radio"]');
  if (!radio) return;
  const card = radio.closest('.company-card');
  const company = state.companies[Number(card.dataset.id)];

  setChoice(company, radio.value);
  paintCard(card, company);
  updateChipCounts();
  if (state.flag !== 'all') render();
});

/* Another tab writing the same key would otherwise be clobbered on next save. */
function syncVisibleFlags() {
  el.grid.querySelectorAll('.company-card').forEach((card) => {
    const company = state.companies[Number(card.dataset.id)];
    if (!company) return;
    paintCard(card, company);
  });
}

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return;
  state.flags = loadFlags();
  updateChipCounts();
  if (state.flag !== 'all') render();
  else syncVisibleFlags();
});

let searchTimer;
el.search.addEventListener('input', (event) => {
  state.query = event.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => render({ scrollToTop: true }), 140);
});

el.area.addEventListener('change', (event) => {
  state.area = event.target.value;
  render({ scrollToTop: true });
});

el.sort.addEventListener('change', (event) => {
  state.sort = event.target.value;
  render({ scrollToTop: true });
});

el.chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    state.flag = chip.dataset.flagFilter;
    el.chips.forEach((item) => item.setAttribute('aria-pressed', String(item === chip)));
    render({ scrollToTop: true });
  });
});

function resetFilters() {
  state.query = '';
  state.area = 'all';
  state.sort = 'default';
  state.flag = 'all';
  state.advanced = { mode: 'and', includeUnknown: false, conditions: [] };
  el.search.value = '';
  el.area.value = 'all';
  el.sort.value = 'default';
  el.chips.forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.flagFilter === 'all')));
  syncAdvancedControls();
  render({ scrollToTop: true });
}
el.reset.addEventListener('click', resetFilters);

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) {
    event.preventDefault();
    el.search.focus();
    el.search.select();
  }
});

/* ------------------------------------------------------------
   Advanced search
   ------------------------------------------------------------ */
const MAX_CONDITIONS = 8;
const DEFAULT_FIELD_ORDER = ['capital', 'members', 'established', 'projects', 'company_name', 'location', 'representative'];
let conditionSeq = 0;
let advancedTimer;
let drawerDirty = false;
let lastSummaryMarkup = '';

function newCondition(overrides = {}) {
  const used = new Set(state.advanced.conditions.map((condition) => condition.field));
  const field = overrides.field || DEFAULT_FIELD_ORDER.find((key) => !used.has(key)) || 'company_name';
  return {
    id: `c${++conditionSeq}`,
    field,
    op: SKSearch.operatorsFor(field)[0].key,
    value: '',
    value2: '',
    ...overrides,
  };
}

function conditionItems() {
  return state.advanced.conditions.map((condition) => ({ condition, compiled: SKSearch.compileCondition(condition) }));
}

function findCondition(id) {
  return state.advanced.conditions.find((condition) => condition.id === id);
}

function scheduleRender(delay = 120) {
  drawerDirty = true;
  clearTimeout(advancedTimer);
  advancedTimer = setTimeout(() => render(), delay);
}

function valueMarkup(condition, field, op) {
  if (op.noValue) return '';
  const inputMode = field.type === 'number' ? 'inputmode="decimal"' : '';
  const unit = field.unit ? `<span class="field-unit">${field.unit}</span>` : '';
  const input = (role, value, placeholder, label) => `
    <label class="field-shell flex-1">
      <span class="sr-only">${label}</span>
      <input data-role="${role}" type="text" ${inputMode} autocomplete="off" enterkeyhint="search"
             value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" />${unit}
    </label>`;

  if (op.range) {
    return `
      <div class="col-span-2 flex items-center gap-2">
        ${input('value', condition.value, '下限', `${field.label}の下限`)}
        <span class="text-muted" aria-hidden="true">〜</span>
        ${input('value2', condition.value2, '上限', `${field.label}の上限`)}
      </div>`;
  }
  return `<div class="col-span-2 flex">${input('value', condition.value, field.placeholder, `${field.label}の値`)}</div>`;
}

function conditionRowMarkup(condition, index, { animate = true } = {}) {
  const field = SKSearch.fieldOf(condition.field);
  const op = SKSearch.operatorOf(field.key, condition.op);
  const fieldOptions = SKSearch.FIELDS
    .map((item) => `<option value="${item.key}" ${item.key === field.key ? 'selected' : ''}>${item.label}</option>`)
    .join('');
  const opOptions = SKSearch.operatorsFor(field.key)
    .map((item) => `<option value="${item.key}" ${item.key === op.key ? 'selected' : ''}>${item.label}</option>`)
    .join('');

  return `
    <li class="condition-row" data-id="${condition.id}" ${animate ? '' : 'style="animation:none"'}>
      <div class="flex items-center justify-between gap-3">
        <span data-role="label" class="font-mono text-[10px] tracking-[0.14em] text-muted">CONDITION ${String(index + 1).padStart(2, '0')}</span>
        <button type="button" class="condition-remove" data-remove aria-label="条件${index + 1}を削除">×</button>
      </div>
      <div class="mt-2.5 grid grid-cols-2 gap-2">
        <label class="field-shell"><span class="sr-only">項目</span><select data-role="field">${fieldOptions}</select></label>
        <label class="field-shell"><span class="sr-only">条件</span><select data-role="op">${opOptions}</select></label>
        ${valueMarkup(condition, field, op)}
      </div>
      <p class="condition-hint" data-role="hint"></p>
    </li>`;
}

function renderConditionList() {
  const { conditions } = state.advanced;
  el.conditionList.dataset.mode = state.advanced.mode;
  el.conditionList.innerHTML = conditions.length
    ? conditions.map((condition, index) => conditionRowMarkup(condition, index)).join('')
    : `<li class="border border-dashed border-line px-4 py-8 text-center text-[12px] leading-relaxed text-muted">
         条件がありません。<br />「条件を追加」またはプリセットから始めてください。
       </li>`;
  el.addCondition.disabled = conditions.length >= MAX_CONDITIONS;
  paintConditionHints(conditionItems());
}

function rerenderRow(row, condition, focusRole) {
  const index = state.advanced.conditions.indexOf(condition);
  row.outerHTML = conditionRowMarkup(condition, index, { animate: false });
  const fresh = el.conditionList.querySelector(`[data-id="${condition.id}"]`);
  fresh.querySelector(`[data-role="${focusRole}"]`)?.focus();
  paintConditionHints(conditionItems());
}

function renumberRows() {
  el.conditionList.querySelectorAll('.condition-row').forEach((row, index) => {
    row.querySelector('[data-role="label"]').textContent = `CONDITION ${String(index + 1).padStart(2, '0')}`;
    row.querySelector('[data-remove]').setAttribute('aria-label', `条件${index + 1}を削除`);
  });
}

function paintConditionHints(items) {
  items.forEach(({ condition, compiled }) => {
    const row = el.conditionList.querySelector(`[data-id="${condition.id}"]`);
    if (!row) return;
    const hint = row.querySelector('[data-role="hint"]');
    row.classList.toggle('is-invalid', !compiled.ready && Boolean(compiled.error));
    hint.dataset.tone = compiled.ready ? 'info' : 'error';

    /* "3億" carries its own unit, so the fixed 万円 suffix would read as "3億万円". */
    let note = compiled.error || '';
    if (condition.field === 'capital') {
      let typedUnit = false;
      row.querySelectorAll('input[data-role]').forEach((input) => {
        const ownUnit = /[兆億万千百十円]/.test(input.value);
        typedUnit ||= ownUnit;
        const suffix = input.parentElement.querySelector('.field-unit');
        if (suffix) suffix.hidden = ownUnit;
      });
      if (typedUnit && compiled.ready && !note) {
        note = compiled.op === 'between'
          ? `${SKSearch.describeCondition(compiled)} として検索しています`
          : `${SKSearch.formatYen(compiled.value)} として検索しています`;
      }
    }
    hint.textContent = note;
  });
}

/* Numeric conditions silently drop companies with no value — say how many. */
function unknownNote(readyCompiled) {
  const fields = [...new Set(readyCompiled
    .filter((compiled) => SKSearch.fieldOf(compiled.field).type === 'number'
      && !SKSearch.operatorOf(compiled.field, compiled.op).noValue)
    .map((compiled) => compiled.field))];
  if (!fields.length) return '';
  if (state.advanced.includeUnknown) return '未登録の値も条件を満たすものとして含めています';
  return `未登録のため対象外：${fields
    .map((key) => `${SKSearch.fieldOf(key).label} ${(state.unknownCounts[key] || 0).toLocaleString('en-US')}社`)
    .join('・')}`;
}

function renderAdvancedSummary(items) {
  const ready = items.filter((item) => item.compiled.ready);
  el.advancedCount.hidden = !ready.length;
  el.advancedCount.textContent = String(ready.length);

  const joiner = state.advanced.mode === 'or' ? 'OR' : 'AND';
  const chips = ready.map((item, index) => {
    const label = escapeHtml(SKSearch.describeCondition(item.compiled));
    return `${index ? `<span class="condition-mode">${joiner}</span>` : ''}`
      + `<span class="condition-chip"><span>${label}</span>`
      + `<button type="button" data-remove-condition="${item.condition.id}" aria-label="${label}を解除">×</button></span>`;
  }).join('');
  const markup = chips && state.advanced.includeUnknown
    ? `${chips}<span class="ml-1 font-mono text-[10px] text-muted">＋未登録を含む</span>`
    : chips;

  /* Only touch the DOM when the chips change, so they do not re-animate on every keystroke. */
  if (markup !== lastSummaryMarkup) {
    el.activeConditions.innerHTML = markup;
    el.activeConditions.hidden = !markup;
    lastSummaryMarkup = markup;
  }

  const count = state.filtered.length.toLocaleString('en-US');
  if (el.drawerCount.textContent !== count) {
    el.drawerCount.textContent = count;
    if (!REDUCED_MOTION && el.drawer.open) {
      el.drawerCount.classList.remove('is-bumped');
      void el.drawerCount.offsetWidth;
      el.drawerCount.classList.add('is-bumped');
    }
  }
  el.drawerNote.textContent = unknownNote(ready.map((item) => item.compiled));
  paintConditionHints(items);
}

function syncAdvancedControls() {
  el.modeButtons.forEach((button) => button.setAttribute('aria-checked', String(button.dataset.mode === state.advanced.mode)));
  el.conditionList.dataset.mode = state.advanced.mode;
  el.includeUnknown.checked = state.advanced.includeUnknown;
}

function openDrawer() {
  if (!state.companies.length) return;
  if (!state.advanced.conditions.length) state.advanced.conditions.push(newCondition());
  drawerDirty = false;
  syncAdvancedControls();
  renderConditionList();
  renderAdvancedSummary(conditionItems());
  el.drawer.showModal();
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    const inputs = [...el.conditionList.querySelectorAll('input[data-role]')];
    (inputs.find((input) => !input.value) || inputs[0])?.focus({ preventScroll: true });
  });
}

el.advancedButton.addEventListener('click', openDrawer);
el.drawer.querySelectorAll('[data-drawer-close]').forEach((button) => {
  button.addEventListener('click', () => el.drawer.close());
});
el.drawer.addEventListener('click', (event) => {
  if (event.target === el.drawer) el.drawer.close();
});
el.drawer.addEventListener('close', () => {
  document.body.style.overflow = '';
  /* Drop rows that were never filled in, so they do not linger. */
  state.advanced.conditions = state.advanced.conditions.filter((condition) => {
    const compiled = SKSearch.compileCondition(condition);
    return compiled.ready || compiled.error || condition.value || condition.value2;
  });
  clearTimeout(advancedTimer);
  if (drawerDirty) render({ scrollToTop: true });
  else renderAdvancedSummary(conditionItems());
  drawerDirty = false;
});

el.conditionList.addEventListener('change', (event) => {
  const role = event.target.dataset.role;
  if (role !== 'field' && role !== 'op') return;
  const row = event.target.closest('.condition-row');
  const condition = findCondition(row.dataset.id);

  if (role === 'field') {
    const previousType = SKSearch.fieldOf(condition.field).type;
    condition.field = event.target.value;
    if (SKSearch.fieldOf(condition.field).type !== previousType) {
      condition.op = SKSearch.operatorsFor(condition.field)[0].key;
      condition.value = '';
      condition.value2 = '';
    }
    rerenderRow(row, condition, 'field');
  } else {
    const before = SKSearch.operatorOf(condition.field, condition.op);
    condition.op = event.target.value;
    const after = SKSearch.operatorOf(condition.field, condition.op);
    if (Boolean(before.noValue) !== Boolean(after.noValue) || Boolean(before.range) !== Boolean(after.range)) {
      rerenderRow(row, condition, after.noValue ? 'op' : 'value');
    }
  }
  scheduleRender(0);
});

el.conditionList.addEventListener('input', (event) => {
  const role = event.target.dataset.role;
  if (role !== 'value' && role !== 'value2') return;
  const condition = findCondition(event.target.closest('.condition-row').dataset.id);
  condition[role] = event.target.value;
  scheduleRender();
});

el.conditionList.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.matches('input')) {
    event.preventDefault();
    el.drawer.close();
  }
});

el.conditionList.addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove]');
  if (!remove) return;
  const row = remove.closest('.condition-row');
  state.advanced.conditions = state.advanced.conditions.filter((condition) => condition.id !== row.dataset.id);
  el.addCondition.disabled = state.advanced.conditions.length >= MAX_CONDITIONS;

  const finish = () => {
    if (!row.isConnected) return;
    row.remove();
    if (state.advanced.conditions.length) renumberRows();
    else renderConditionList();
  };
  if (REDUCED_MOTION) finish();
  else {
    row.classList.add('is-leaving');
    row.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 450);
  }
  scheduleRender(0);
});

el.addCondition.addEventListener('click', () => {
  if (state.advanced.conditions.length >= MAX_CONDITIONS) return;
  const condition = newCondition();
  state.advanced.conditions.push(condition);
  if (state.advanced.conditions.length === 1) renderConditionList();
  else el.conditionList.insertAdjacentHTML('beforeend', conditionRowMarkup(condition, state.advanced.conditions.length - 1));
  el.addCondition.disabled = state.advanced.conditions.length >= MAX_CONDITIONS;

  const row = el.conditionList.querySelector(`[data-id="${condition.id}"]`);
  row.scrollIntoView({ block: 'nearest', behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
  row.querySelector('[data-role="value"]')?.focus({ preventScroll: true });
});

el.modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    state.advanced.mode = button.dataset.mode;
    syncAdvancedControls();
    scheduleRender(0);
  });
});
document.querySelector('.segmented').addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const next = el.modeButtons.find((button) => button.dataset.mode !== state.advanced.mode);
  next.click();
  next.focus();
});

el.includeUnknown.addEventListener('change', () => {
  state.advanced.includeUnknown = el.includeUnknown.checked;
  scheduleRender(0);
});

document.querySelectorAll('[data-preset]').forEach((button) => {
  button.addEventListener('click', () => {
    state.advanced.conditions = [];
    SKSearch.presets()[button.dataset.preset].forEach((condition) => {
      state.advanced.conditions.push(newCondition(condition));
    });
    state.advanced.mode = 'and';
    syncAdvancedControls();
    renderConditionList();
    scheduleRender(0);
  });
});

el.clearConditions.addEventListener('click', () => {
  state.advanced.conditions = [];
  renderConditionList();
  scheduleRender(0);
});

el.activeConditions.addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove-condition]');
  if (!button) return;
  state.advanced.conditions = state.advanced.conditions.filter((condition) => condition.id !== button.dataset.removeCondition);
  render({ scrollToTop: true });
  el.advancedButton.focus({ preventScroll: true });
});

/* Infinite scroll */
new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) renderBatch();
}, { rootMargin: '600px 0px' }).observe(el.sentinel);

/* Scroll chrome: progress bar, header shadow, back-to-top */
let ticking = false;
window.addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    el.progress.style.width = `${max > 0 ? (window.scrollY / max) * 100 : 0}%`;
    el.header.classList.toggle('shadow-[0_10px_30px_-24px_rgba(23,33,31,0.8)]', window.scrollY > 12);

    const show = window.scrollY > 600;
    el.toTop.classList.toggle('opacity-0', !show);
    el.toTop.classList.toggle('translate-y-4', !show);
    el.toTop.classList.toggle('scale-90', !show);
    el.toTop.classList.toggle('opacity-100', show);
    ticking = false;
  });
}, { passive: true });

el.toTop.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
});

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
function showSkeleton() {
  el.grid.innerHTML = Array.from({ length: 6 }, () => `
    <div class="skeleton-card">
      <span class="skeleton-bar h-3 w-12"></span>
      <span class="skeleton-bar mt-8 h-5 w-3/4"></span>
      <span class="skeleton-bar mt-3 h-3 w-1/2"></span>
      <span class="skeleton-bar mt-12 h-3 w-24"></span>
    </div>`).join('');
}

/* The CSV is only requested once the lock screen has been passed. */
function bootDirectory() {
  showSkeleton();
  observeReveals();

  fetch('system_kanji_companies.csv')
    .then((response) => {
      if (!response.ok) throw new Error(response.statusText);
      return response.text();
    })
    .then((text) => {
      state.companies = parseCsv(text).map((company, index) => {
        const projectCount = Number(company.system_kanji_project_count) || 0;
        const record = {
          ...company,
          id: index,
          key: company.system_kanji_profile_link || `row-${index}`,
          area: getArea(company.location),
          projects: String(projectCount),
          projectCount,
        };
        record.search = SKSearch.indexCompany(record);
        return record;
      });

      const areas = [...new Set(state.companies.map((company) => company.area))].sort((a, b) => areaRank(a) - areaRank(b));
      const counts = state.companies.reduce((accumulator, company) => {
        accumulator[company.area] = (accumulator[company.area] || 0) + 1;
        return accumulator;
      }, {});
      areas.forEach((area) => {
        const option = document.createElement('option');
        option.value = area;
        option.textContent = `${area}（${counts[area]}）`;
        el.area.append(option);
      });

      countUp(document.querySelector('#statCompanies'), state.companies.length);
      countUp(document.querySelector('#statAreas'), areas.length);
      countUp(document.querySelector('#statProjects'), state.companies.reduce((sum, company) => sum + company.projectCount, 0));

      updateChipCounts();
      state.unknownCounts = Object.fromEntries(SKSearch.FIELDS
        .filter((field) => field.type === 'number')
        .map((field) => [field.key, state.companies.filter((company) => company.search[field.key] === null).length]));
      el.drawerTotal.textContent = state.companies.length.toLocaleString('en-US');
      if (!STORAGE_AVAILABLE) warnStorage();
      render();
    })
    .catch(() => {
      el.grid.innerHTML = `
        <div class="col-span-full border border-dashed border-orange/50 bg-orange-wash/40 px-6 py-16 text-center">
          <p class="font-mono text-[11px] tracking-[0.12em] text-orange">LOAD ERROR</p>
          <p class="mt-3 text-[14px] leading-relaxed text-ink-soft">
            CSV を読み込めませんでした。<br />
            <code class="font-mono text-[12px]">npm run serve</code> などのローカルサーバー経由で開いてください。
          </p>
        </div>`;
      el.resultCount.textContent = '';
      el.status.textContent = 'CSV LOAD FAILED';
    });
}

if (window.SKAuth?.isUnlocked()) bootDirectory();
else window.addEventListener('sk:unlocked', bootDirectory, { once: true });
