const state = { companies: [], filtered: [] };
const grid = document.querySelector('#companyGrid');
const searchInput = document.querySelector('#searchInput');
const categorySelect = document.querySelector('#categorySelect');
const resultCount = document.querySelector('#resultCount');
const statusMessage = document.querySelector('#statusMessage');
const modal = document.querySelector('#companyModal');

const fields = {
  company_name: '会社名',
  capital: '資本金',
  establishment_year: '設立',
  number_of_members: '社員数',
  company_website: '公式サイト',
  location: '所在地',
  representative: '代表',
};
const modalIds = {
  capital: 'modalCapital',
  establishment_year: 'modalEstablishment',
  number_of_members: 'modalMembers',
  representative: 'modalRepresentative',
};

function parseCsv(text) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (char === '"' && quoted && next === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value); rows.push(row); row = []; value = '';
    } else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, ''));
  return rows.filter((item) => item.some(Boolean)).map((item) => Object.fromEntries(headers.map((header, index) => [header, item[index] || ''])));
}

function getCategory(location) {
  const match = location.match(/(北海道|東京都|大阪府|京都府|.{2,3}県)/);
  return match ? match[1] : 'その他';
}

function render() {
  const query = searchInput.value.trim().toLowerCase();
  const category = categorySelect.value;
  state.filtered = state.companies.filter((company) => {
    const haystack = [company.company_name, company.location, company.representative, company.capital].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (category === 'all' || company.category === category);
  });
  resultCount.textContent = `${state.filtered.length} / ${state.companies.length} COMPANIES`;
  statusMessage.textContent = query || category !== 'all' ? 'FILTERED VIEW' : '';
  grid.innerHTML = state.filtered.length ? state.filtered.map((company, index) => `
    <article class="company-card ${company.firstChecked ? 'first-checked' : ''} ${company.firstChecked && company.secondChecked ? 'both-checked' : ''}" tabindex="0" data-index="${state.companies.indexOf(company)}" style="animation-delay:${Math.min(index * 35, 350)}ms">
      <div class="card-top"><span class="card-index">${String(index + 1).padStart(2, '0')}</span><span class="card-category">${company.category}</span></div>
      <div class="card-checks" aria-label="${escapeHtml(company.company_name)}のチェック">
        <label><input type="checkbox" data-check="first" ${company.firstChecked ? 'checked' : ''} /> <span>1</span></label>
        <label><input type="checkbox" data-check="second" ${company.secondChecked ? 'checked' : ''} /> <span>2</span></label>
      </div>
      <h3>${escapeHtml(company.company_name)}</h3>
      <p class="card-location">${escapeHtml(company.location || '所在地未登録')}</p>
      <div class="card-bottom"><span class="card-projects">${company.system_kanji_project_count || '0'} PROJECTS</span><span class="card-open">詳細を見る　→</span></div>
    </article>`).join('') : '<div class="empty-state">条件に一致する会社が見つかりませんでした。</div>';
}

function escapeHtml(value) { return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char])); }

function openCompany(company) {
  document.querySelector('#modalCompanyName').textContent = company.company_name;
  document.querySelector('#modalLocation').textContent = company.location || '所在地未登録';
  document.querySelector('#modalProjects').textContent = `${company.system_kanji_project_count || '0'} PROJECTS`;
  document.querySelector('#modalWebsite').href = company.company_website || '#';
  document.querySelector('#modalProfile').href = company.system_kanji_profile_link;
  Object.keys(fields).filter((key) => key !== 'company_name' && key !== 'location' && key !== 'company_website').forEach((key) => {
    document.querySelector(`#${modalIds[key]}`).textContent = company[key] || '未登録';
  });
  modal.showModal();
}

grid.addEventListener('click', (event) => {
  if (event.target.closest('.card-checks')) return;
  const card = event.target.closest('.company-card');
  if (card) openCompany(state.companies[Number(card.dataset.index)]);
});
grid.addEventListener('change', (event) => {
  const checkbox = event.target.closest('input[data-check]');
  if (!checkbox) return;
  const card = checkbox.closest('.company-card');
  const company = state.companies[Number(card.dataset.index)];
  company.firstChecked = card.querySelector('[data-check="first"]').checked;
  company.secondChecked = card.querySelector('[data-check="second"]').checked;
  card.classList.toggle('first-checked', company.firstChecked);
  card.classList.toggle('both-checked', company.firstChecked && company.secondChecked);
});
grid.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.target.click(); } });
searchInput.addEventListener('input', render);
categorySelect.addEventListener('change', render);
document.querySelector('#modalClose').addEventListener('click', () => modal.close());
modal.addEventListener('click', (event) => { if (event.target === modal) modal.close(); });
document.addEventListener('keydown', (event) => { if (event.key === '/' && document.activeElement !== searchInput) { event.preventDefault(); searchInput.focus(); } });

fetch('system_kanji_companies.csv').then((response) => response.text()).then((text) => {
  state.companies = parseCsv(text).map((company) => ({ ...company, category: getCategory(company.location) }));
  document.querySelector('#heroCount').textContent = String(state.companies.length).padStart(2, '0');
  [...new Set(state.companies.map((company) => company.category))].sort((a, b) => a.localeCompare(b, 'ja')).forEach((category) => {
    const option = document.createElement('option'); option.value = category; option.textContent = category; categorySelect.append(option);
  });
  render();
}).catch(() => { resultCount.textContent = ''; statusMessage.textContent = 'CSVを読み込めませんでした。ローカルサーバーで開いてください。'; });