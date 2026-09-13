/* ============================================================
   Lock screen — 15-digit PIN, entered as the teeth of a key.

   This is a deterrent, not security: the site is static, so the
   CSV and every other asset remain directly fetchable. The PIN is
   stored as a PBKDF2-SHA256 verifier so it cannot simply be read
   out of this file.
   ============================================================ */
(() => {
  const PIN_LENGTH = 15;
  const SALT_HEX = 'e1303e09e38f970df71413db7624c062';
  const VERIFIER = '6a17a61c049d70b0f2a75e8736bf9a5edfeb5da28e84a1fa8ba5d9a21d9683f7';
  const ITERATIONS = 250000;

  const SESSION_KEY = 'system-kanji-unlocked';
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 30000;

  const root = document.documentElement;
  const screenEl = document.querySelector('#lockScreen');
  const keyEl = document.querySelector('#keyGraphic');
  const teeth = [...document.querySelectorAll('.key-tooth')];
  const padEl = document.querySelector('#keypad');
  const messageEl = document.querySelector('#lockMessage');
  const progressEl = document.querySelector('#lockProgress');
  const submitEl = document.querySelector('#lockSubmit');
  const shell = [document.querySelector('#siteHeader'), document.querySelector('main'), document.querySelector('footer')];

  let entry = '';
  let attempts = 0;
  let busy = false;
  let lockedUntil = 0;

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- session ---------- */
  function readSession() {
    try {
      return sessionStorage.getItem(SESSION_KEY) === VERIFIER;
    } catch {
      return false;
    }
  }
  function writeSession() {
    try {
      sessionStorage.setItem(SESSION_KEY, VERIFIER);
    } catch {
      /* unlock simply will not persist across reloads */
    }
  }

  /* ---------- verification ---------- */
  function hexToBytes(hex) {
    return Uint8Array.from(hex.match(/.{2}/g).map((byte) => parseInt(byte, 16)));
  }
  function bytesToHex(buffer) {
    return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function verify(pin) {
    if (!window.crypto?.subtle) throw new Error('insecure-context');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: hexToBytes(SALT_HEX), iterations: ITERATIONS, hash: 'SHA-256' },
      key,
      256,
    );
    return bytesToHex(bits) === VERIFIER;
  }

  /* ---------- view ---------- */
  function paint() {
    teeth.forEach((tooth, index) => tooth.classList.toggle('is-cut', index < entry.length));
    progressEl.textContent = `${entry.length} / ${PIN_LENGTH}`;
    submitEl.disabled = entry.length !== PIN_LENGTH || busy;
    screenEl.querySelector('[data-action="back"]').disabled = !entry.length || busy;
    screenEl.querySelector('[data-action="clear"]').disabled = !entry.length || busy;
  }

  function say(text, tone = 'idle') {
    messageEl.textContent = text;
    messageEl.dataset.tone = tone;
  }

  function reject(text) {
    entry = '';
    paint();
    say(text, 'error');
    if (REDUCED) return;
    keyEl.classList.remove('is-wrong');
    void keyEl.offsetWidth; /* restart the animation */
    keyEl.classList.add('is-wrong');
  }

  function startLockout() {
    lockedUntil = Date.now() + LOCKOUT_MS;
    padEl.setAttribute('aria-disabled', 'true');
    const tick = () => {
      const left = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (left > 0) {
        say(`試行回数の上限に達しました。${left} 秒後に再試行できます。`, 'error');
        setTimeout(tick, 250);
      } else {
        attempts = 0;
        padEl.removeAttribute('aria-disabled');
        say('PIN を入力してください', 'idle');
      }
    };
    tick();
  }

  function unlock({ animate = true } = {}) {
    writeSession();
    shell.forEach((node) => node && node.removeAttribute('inert'));

    const finish = () => {
      root.removeAttribute('data-locked');
      screenEl.remove();
      window.dispatchEvent(new CustomEvent('sk:unlocked'));
    };

    if (!animate || REDUCED) {
      finish();
      return;
    }
    keyEl.classList.add('is-turning');
    screenEl.classList.add('is-opening');
    screenEl.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 1200); /* guard if the transition never fires */
  }

  async function submit() {
    if (busy || entry.length !== PIN_LENGTH) return;
    busy = true;
    paint();
    say('確認中…', 'idle');

    try {
      if (await verify(entry)) {
        say('解錠しました', 'ok');
        busy = false;
        unlock();
        return;
      }
      attempts += 1;
      busy = false;
      if (attempts >= MAX_ATTEMPTS) {
        entry = '';
        paint();
        startLockout();
      } else {
        reject(`PIN が違います（残り ${MAX_ATTEMPTS - attempts} 回）`);
      }
    } catch (error) {
      busy = false;
      reject(error.message === 'insecure-context'
        ? 'この環境では認証できません。HTTPS または localhost で開いてください。'
        : '認証に失敗しました。もう一度お試しください。');
    }
  }

  function push(digit) {
    if (busy || Date.now() < lockedUntil || entry.length >= PIN_LENGTH) return;
    entry += digit;
    paint();
    if (messageEl.dataset.tone === 'error') say('PIN を入力してください', 'idle');

    const tooth = teeth[entry.length - 1];
    if (tooth && !REDUCED) {
      tooth.classList.remove('just-cut');
      void tooth.offsetWidth;
      tooth.classList.add('just-cut');
    }
    if (entry.length === PIN_LENGTH) submit();
  }

  /* ---------- events ---------- */
  padEl.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || padEl.getAttribute('aria-disabled') === 'true') return;
    const { digit, action } = button.dataset;
    if (digit) push(digit);
    else if (action === 'back') { entry = entry.slice(0, -1); paint(); }
    else if (action === 'clear') { entry = ''; paint(); }
  });

  submitEl.addEventListener('click', submit);

  document.addEventListener('keydown', (event) => {
    if (!root.hasAttribute('data-locked')) return;
    if (event.key >= '0' && event.key <= '9') { event.preventDefault(); push(event.key); }
    else if (event.key === 'Backspace') { event.preventDefault(); entry = entry.slice(0, -1); paint(); }
    else if (event.key === 'Escape') { event.preventDefault(); entry = ''; paint(); }
    else if (event.key === 'Enter') { event.preventDefault(); submit(); }
  });

  /* Paste a full PIN rather than typing 15 digits. */
  document.addEventListener('paste', (event) => {
    if (!root.hasAttribute('data-locked')) return;
    const digits = (event.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, PIN_LENGTH);
    if (!digits) return;
    event.preventDefault();
    entry = digits;
    paint();
    if (entry.length === PIN_LENGTH) submit();
  });

  /* ---------- boot ---------- */
  window.SKAuth = { isUnlocked: () => !root.hasAttribute('data-locked') };

  if (readSession()) {
    unlock({ animate: false });
  } else {
    shell.forEach((node) => node && node.setAttribute('inert', ''));
    paint();
    say('PIN を入力してください', 'idle');
    requestAnimationFrame(() => screenEl.classList.add('is-ready'));
  }
})();
