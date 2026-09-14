/* ============================================================
   Search fields — value parsers and condition matching.

   The CSV holds free text ("4,000万円", "約250人(グループ会社)"),
   so every numeric field is parsed once at load time and compared
   as a number. Loaded before app.js; also importable from Node.
   ============================================================ */
(function (root) {
  const KANJI_DIGITS = {
    '〇': '0', '零': '0', '一': '1', '壱': '1', '二': '2', '弐': '2', '三': '3', '参': '3',
    '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9',
  };
  const LARGE_UNITS = { 兆: 1e12, 億: 1e8, 万: 1e4 };
  const SMALL_UNITS = { 千: 1e3, 百: 1e2, 十: 10 };
  const BRACKET_UNITS = { 百万: 1e6, 万: 1e4, 千: 1e3 };
  const ERAS = { 明治: 1867, 大正: 1911, 昭和: 1925, 平成: 1988, 令和: 2018 };
  const CURRENT_YEAR = new Date().getFullYear();

  /* ---------- text ---------- */
  function normalize(value) {
    return String(value ?? '').normalize('NFKC').replace(/[​-‍﻿]/g, '').trim();
  }

  /* Width-, case- and whitespace-insensitive form used for all text matching. */
  function normText(value) {
    return normalize(value).toLowerCase().replace(/\s+/g, ' ');
  }

  /* Drops "(2024年3月現在)", "（資本準備金含む）", "※…" and similar annotations. */
  function stripNotes(text) {
    return text.replace(/[(（【\[][^)）】\]]*[)）】\]]/g, ' ').replace(/※.*$/, ' ');
  }

  /* ---------- numbers ---------- */
  function toNumber(token) {
    /* "10.000.000" uses dots as thousand separators. */
    const plain = /^\d{1,3}(\.\d{3})+$/.test(token) ? token.replace(/\./g, '') : token;
    const number = Number(plain);
    return Number.isFinite(number) ? number : null;
  }

  /* "2億3744万5千" -> 237445000. */
  function readJapaneseNumber(expression) {
    const tokens = expression.match(/\d+(?:\.\d+)*|[兆億万千百十]/g);
    if (!tokens) return null;
    let total = 0;
    let section = 0;
    let current = null;
    let sawUnit = false;
    for (const token of tokens) {
      if (/\d/.test(token)) {
        current = toNumber(token);
        if (current === null) return null;
      } else if (token in SMALL_UNITS) {
        section += (current ?? 1) * SMALL_UNITS[token];
        current = null;
        sawUnit = true;
      } else {
        total += ((section + (current ?? 0)) || 1) * LARGE_UNITS[token];
        section = 0;
        current = null;
        sawUnit = true;
      }
    }
    return { value: total + section + (current ?? 0), sawUnit };
  }

  function kanjiToDigits(text) {
    return text.replace(/[〇零一壱二弐三参四五六七八九]/g, (char) => KANJI_DIGITS[char]);
  }

  /* Capital in yen, or null when it cannot be read with confidence. */
  function parseCapital(raw) {
    let text = normalize(raw).replace(/憶/g, '億');
    if (!text) return null;
    /* Foreign-currency figures ("45,000 ドル") cannot be compared with yen. */
    if (/ドル|\$|usd|€|ユーロ|ドン|ウォン|ペソ|バーツ/i.test(text)) return null;

    /* "授権資本金 4,000万円 払込資本金 1,000万円" — paid-in is the real capital. */
    const paidIn = text.match(/払込(?:資本金)?[^\d]*([\d,.\s兆億万千百十]+円?)/);
    if (paidIn) text = paidIn[1];

    /* "3,000(千円)" puts the unit inside the brackets we are about to strip. */
    const bracketUnit = text.match(/[(（]\s*(百万|万|千)円\s*[)）]/);

    const compact = kanjiToDigits(stripNotes(text)).replace(/[,\s]/g, '');
    const expression = compact.match(/[\d.]+(?:[兆億万千百十]+[\d.]*)*/);
    if (!expression) return null;

    const parsed = readJapaneseNumber(expression[0]);
    if (!parsed || parsed.value <= 0) return null;
    if (parsed.sawUnit) return Math.round(parsed.value);
    if (bracketUnit) return Math.round(parsed.value * BRACKET_UNITS[bracketUnit[1]]);

    /* A unit-less figure is only trusted when it is plainly yen ("5000000", "5,000,000円"). */
    if (/年/.test(compact) && !/円/.test(compact)) return null;
    return parsed.value >= 10000 ? Math.round(parsed.value) : null;
  }

  /* Headcount, or null. */
  function parseMembers(raw) {
    const text = normalize(raw);
    if (!text || /円/.test(text)) return null;

    const body = stripNotes(text);
    const counted = body.match(/(\d[\d,]*)\s*(?:名|人)/) || text.match(/(\d[\d,]*)\s*(?:名|人)/);
    if (counted) return Number(counted[1].replace(/,/g, ''));

    if (/[年月日@.]/.test(body)) return null;
    const bare = body.match(/^\D{0,6}?(\d[\d,]*)\D{0,6}$/);
    return bare ? Number(bare[1].replace(/,/g, '')) : null;
  }

  function plausibleYear(year) {
    return year >= 1850 && year <= CURRENT_YEAR + 1 ? year : null;
  }

  /* Year of establishment, western or 和暦. */
  function parseYear(raw) {
    const text = normalize(raw);
    if (!text || /円/.test(text)) return null;
    const western = text.match(/(?:^|\D)(1[89]\d{2}|20\d{2})(?!\d)/);
    if (western) return plausibleYear(Number(western[1]));
    const era = text.match(/(明治|大正|昭和|平成|令和)\s*(元|\d{1,2})\s*年/);
    if (era) return plausibleYear(ERAS[era[1]] + (era[2] === '元' ? 1 : Number(era[2])));
    return null;
  }

  /* ---------- field + operator catalogue ---------- */
  const FIELDS = [
    { key: 'company_name', label: '会社名', type: 'text', placeholder: '例：システム' },
    { key: 'location', label: '所在地', type: 'text', placeholder: '例：渋谷区' },
    { key: 'representative', label: '代表者', type: 'text', placeholder: '例：田中' },
    { key: 'capital', label: '資本金', type: 'number', unit: '万円', scale: 1e4, placeholder: '例：300' },
    { key: 'members', label: '社員数', type: 'number', unit: '人', scale: 1, placeholder: '例：10' },
    { key: 'established', label: '設立年', type: 'number', unit: '年', scale: 1, placeholder: '例：2020' },
    { key: 'projects', label: '実績数', type: 'number', unit: '件', scale: 1, placeholder: '例：5' },
  ];
  const FIELD_MAP = Object.fromEntries(FIELDS.map((field) => [field.key, field]));

  const OPERATORS = {
    text: [
      { key: 'contains', label: 'を含む' },
      { key: 'not_contains', label: 'を含まない' },
      { key: 'starts', label: 'で始まる' },
      { key: 'equals', label: 'と完全一致' },
      { key: 'present', label: '登録あり', noValue: true },
      { key: 'empty', label: '未登録', noValue: true },
    ],
    number: [
      { key: 'lte', label: '以下' },
      { key: 'lt', label: '未満' },
      { key: 'gte', label: '以上' },
      { key: 'gt', label: 'より大きい' },
      { key: 'eq', label: 'と等しい' },
      { key: 'between', label: '範囲指定', range: true },
      { key: 'present', label: '登録あり', noValue: true },
      { key: 'empty', label: '未登録', noValue: true },
    ],
  };

  const fieldOf = (key) => FIELD_MAP[key] || FIELDS[0];
  const operatorsFor = (fieldKey) => OPERATORS[fieldOf(fieldKey).type];
  const operatorOf = (fieldKey, opKey) => operatorsFor(fieldKey).find((op) => op.key === opKey) || operatorsFor(fieldKey)[0];

  /* ---------- records ---------- */
  function indexCompany(company) {
    return {
      company_name: normText(company.company_name),
      location: normText(company.location),
      representative: normText(company.representative),
      capital: parseCapital(company.capital),
      members: parseMembers(company.number_of_members),
      established: parseYear(company.establishment_year),
      projects: Number.isFinite(Number(company.system_kanji_project_count))
        ? Number(company.system_kanji_project_count) : null,
      haystack: normText([
        company.company_name, company.location, company.representative, company.capital,
        company.number_of_members, company.establishment_year, company.company_website, company.area,
      ].join(' ')),
    };
  }

  /* Space-separated terms must all appear (AND). */
  function matchKeywords(record, query) {
    const terms = normText(query).split(' ').filter(Boolean);
    return terms.every((term) => record.haystack.includes(term));
  }

  /* ---------- conditions ---------- */
  /* Reads what the user typed. Capital also accepts "3億" or "5000000円". */
  function readInput(field, input) {
    const text = normalize(input).replace(/[,\s]/g, '');
    if (!text) return { empty: true };
    if (field.key === 'capital' && /[兆億万千百十円]/.test(text)) {
      const yen = parseCapital(/円$/.test(text) ? text : `${text}円`);
      return yen === null ? { invalid: true } : { value: yen };
    }
    const number = Number(text);
    return Number.isFinite(number) ? { value: number * (field.scale || 1) } : { invalid: true };
  }

  /*
   * Turns a UI condition into a matcher-ready one.
   * Returns { ready, error, ...compiled }; incomplete conditions are simply not applied.
   */
  function compileCondition(condition) {
    const field = fieldOf(condition.field);
    const op = operatorOf(field.key, condition.op);
    const base = { field: field.key, op: op.key };

    if (op.noValue) return { ...base, ready: true };

    if (field.type === 'text') {
      const needle = normText(condition.value);
      return needle ? { ...base, ready: true, needle } : { ...base, ready: false };
    }

    const a = readInput(field, condition.value);
    if (a.invalid) return { ...base, ready: false, error: '数値を入力してください' };

    if (op.range) {
      const b = readInput(field, condition.value2);
      if (b.invalid) return { ...base, ready: false, error: '数値を入力してください' };
      if (a.empty && b.empty) return { ...base, ready: false };
      const min = a.empty ? -Infinity : a.value;
      const max = b.empty ? Infinity : b.value;
      return min > max
        ? { ...base, ready: true, min: max, max: min, error: '下限と上限を入れ替えて検索しています' }
        : { ...base, ready: true, min, max };
    }
    return a.empty ? { ...base, ready: false } : { ...base, ready: true, value: a.value };
  }

  function matchCondition(record, compiled, includeUnknown) {
    const field = fieldOf(compiled.field);
    const value = record[field.key];
    const missing = field.type === 'text' ? !value : value === null;

    if (compiled.op === 'present') return !missing;
    if (compiled.op === 'empty') return missing;

    if (field.type === 'text') {
      switch (compiled.op) {
        case 'contains': return value.includes(compiled.needle);
        case 'not_contains': return !value.includes(compiled.needle);
        case 'starts': return value.startsWith(compiled.needle);
        case 'equals': return value === compiled.needle;
        default: return false;
      }
    }

    if (missing) return includeUnknown;
    switch (compiled.op) {
      case 'lte': return value <= compiled.value;
      case 'lt': return value < compiled.value;
      case 'gte': return value >= compiled.value;
      case 'gt': return value > compiled.value;
      case 'eq': return value === compiled.value;
      case 'between': return value >= compiled.min && value <= compiled.max;
      default: return false;
    }
  }

  function matchAll(record, compiledList, mode, includeUnknown) {
    if (!compiledList.length) return true;
    return mode === 'or'
      ? compiledList.some((compiled) => matchCondition(record, compiled, includeUnknown))
      : compiledList.every((compiled) => matchCondition(record, compiled, includeUnknown));
  }

  /* ---------- display ---------- */
  function trimDecimals(number, digits = 2) {
    return Number(number.toFixed(digits)).toLocaleString('ja-JP');
  }

  function formatYen(yen) {
    if (yen === null || yen === undefined) return '—';
    if (yen >= 1e8) return `${trimDecimals(yen / 1e8)}億円`;
    if (yen >= 1e4) return `${trimDecimals(yen / 1e4, 1)}万円`;
    return `${Math.round(yen).toLocaleString('ja-JP')}円`;
  }

  function formatValue(fieldKey, value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const field = fieldOf(fieldKey);
    if (field.key === 'capital') return formatYen(value);
    if (field.key === 'established') return `${value}年`;
    return `${value.toLocaleString('ja-JP')}${field.unit}`;
  }

  /* "資本金 300万円以下", "会社名に「AI」を含む" */
  function describeCondition(compiled) {
    const field = fieldOf(compiled.field);
    const op = operatorOf(field.key, compiled.op);
    if (op.noValue) return `${field.label}が${op.label}`;
    if (field.type === 'text') return `${field.label}に「${compiled.needle}」${op.label}`;
    if (op.range) {
      const low = Number.isFinite(compiled.min) ? formatValue(field.key, compiled.min) : '';
      const high = Number.isFinite(compiled.max) ? formatValue(field.key, compiled.max) : '';
      return `${field.label} ${low}〜${high}`;
    }
    return `${field.label} ${formatValue(field.key, compiled.value)}${op.label}`;
  }

  /* ---------- presets ---------- */
  function presets(year = CURRENT_YEAR) {
    return {
      small: [{ field: 'capital', op: 'lte', value: '300' }, { field: 'members', op: 'lt', value: '10' }],
      young: [{ field: 'established', op: 'gte', value: String(year - 5) }],
      proven: [{ field: 'projects', op: 'gte', value: '10' }],
      large: [{ field: 'capital', op: 'gte', value: '10000' }, { field: 'members', op: 'gte', value: '100' }],
    };
  }

  const api = {
    normalize, normText, parseCapital, parseMembers, parseYear,
    FIELDS, OPERATORS, fieldOf, operatorsFor, operatorOf,
    indexCompany, matchKeywords, compileCondition, matchCondition, matchAll,
    formatYen, formatValue, describeCondition, presets,
  };
  root.SKSearch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
