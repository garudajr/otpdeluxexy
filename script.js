/* ============================================================
 *  PORTAL OTP - FRONTEND
 *  Ubah bagian CONFIG di bawah ini sebelum di-upload ke GitHub.
 * ============================================================ */
(function () {
  'use strict';

  var CONFIG = {
    // URL Web App Google Apps Script (berakhiran /exec)
    API_URL: 'https://script.google.com/macros/s/AKfycbz_7ugFqTtnX2324JUum2uskGYmxm6Shz3a32gD5OmSHaTaLhqDOmOOXuKpPfkGIf6FPw/exec',

    STORE_NAME: 'Deluxexy',

    // Nomor WhatsApp format internasional tanpa + / 0 di depan (contoh: 6281234567890)
    WA_NUMBER: '6282245222845',
    WA_MESSAGE: 'Halo admin, saya mau minta OTP untuk aplikasi lain.',

    // Username Telegram tanpa @
    TELEGRAM_USERNAME: 'roock',

    COOLDOWN_SECONDS: 20,
    REQUEST_TIMEOUT_MS: 25000
  };

  var LABEL = { netflix: 'Netflix', disney: 'Disney+' };
  var KEY_PIN = 'otp_pin';

  function $(id) { return document.getElementById(id); }

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  var state = { pin: null, name: '', services: { netflix: false, disney: false } };
  var busy = { netflix: false, disney: false };
  var timers = {};
  var defaultSub = {};

  /* ---------- API ---------- */
  function api(payload) {
    if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('GANTI_DENGAN') === 0) {
      return Promise.resolve({ ok: false, error: 'Website belum dikonfigurasi (API_URL kosong).' });
    }
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, CONFIG.REQUEST_TIMEOUT_MS);
    // text/plain => tidak memicu preflight CORS (Apps Script tidak mendukung OPTIONS)
    return fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      redirect: 'follow'
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .catch(function (e) {
        return {
          ok: false,
          error: e && e.name === 'AbortError'
            ? 'Server terlalu lama merespons. Coba lagi.'
            : 'Tidak dapat terhubung ke server. Periksa koneksi internet kamu.'
        };
      })
      .then(function (r) { clearTimeout(t); return r; });
  }

  /* ---------- Tampilan ---------- */
  function showLogin() {
    $('viewDash').hidden = true;
    $('viewLogin').hidden = false;
    $('result').hidden = true;
  }

  function showDash() {
    $('viewLogin').hidden = true;
    $('viewDash').hidden = false;
    $('greeting').textContent = state.name ? 'Halo, ' + state.name + '!' : 'Halo!';
    ['netflix', 'disney'].forEach(tickCooldown);
  }

  function setLoginError(msg) {
    var el = $('loginError');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  /* ---------- Login ---------- */
  function doLogin(pin, silent) {
    var btn = $('loginBtn');
    if (!silent) { btn.disabled = true; btn.textContent = 'Memeriksa...'; setLoginError(''); }

    return api({ action: 'login', pin: pin }).then(function (res) {
      btn.disabled = false; btn.textContent = 'Masuk';
      if (res && res.ok) {
        state.pin = pin;
        state.name = res.name || '';
        state.services = res.services || { netflix: false, disney: false };
        store.set(KEY_PIN, pin);
        showDash();
        return true;
      }
      if (silent) { store.del(KEY_PIN); }
      else { setLoginError((res && res.error) || 'Gagal masuk.'); }
      return false;
    });
  }

  function logout() {
    store.del(KEY_PIN);
    state.pin = null;
    $('pin').value = '';
    showLogin();
  }

  /* ---------- Cooldown ---------- */
  function startCooldown(service, seconds) {
    store.set('cd_' + service, String(Date.now() + seconds * 1000));
    tickCooldown(service);
  }

  function tickCooldown(service) {
    clearInterval(timers[service]);
    var btn = $('btn-' + service);
    var sub = btn.querySelector('.sub');

    function render() {
      var left = Math.ceil((Number(store.get('cd_' + service) || 0) - Date.now()) / 1000);
      if (left > 0) {
        btn.disabled = true;
        sub.textContent = 'Tunggu ' + left + ' detik';
        return true;
      }
      btn.disabled = busy[service];
      if (!busy[service]) sub.textContent = defaultSub[service];
      return false;
    }

    if (render()) {
      timers[service] = setInterval(function () {
        if (!render()) clearInterval(timers[service]);
      }, 500);
    }
  }

  /* ---------- Hasil ---------- */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function copyText(text, btn) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = 'Tersalin \u2713';
      setTimeout(function () { btn.textContent = old; }, 1500);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text); done();
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  function showNote(text, type) {
    var box = $('result');
    box.className = 'result ' + (type || 'info');
    box.textContent = '';
    box.appendChild(el('div', 'note', text));
    box.hidden = false;
  }

  function showSuccess(res) {
    var box = $('result');
    box.className = 'result';
    box.textContent = '';

    if (res.code) {
      box.appendChild(el('div', 'label', 'Kode OTP ' + (res.label || '')));
      box.appendChild(el('div', 'code', res.code));
      var copy = el('button', 'btn copy', 'Salin Kode');
      copy.type = 'button';
      copy.addEventListener('click', function () { copyText(res.code, copy); });
      box.appendChild(copy);
    }

    if (res.link) {
      box.appendChild(el('div', 'label', res.code ? 'Link konfirmasi' : 'Link konfirmasi ' + (res.label || '')));
      var open = el('a', 'btn open', 'Buka Link Konfirmasi');
      open.href = res.link; open.target = '_blank'; open.rel = 'noopener noreferrer';
      box.appendChild(open);
      var copyL = el('button', 'btn copy', 'Salin Link');
      copyL.type = 'button';
      copyL.addEventListener('click', function () { copyText(res.link, copyL); });
      box.appendChild(copyL);
    }

    if (typeof res.ageSeconds === 'number') {
      var s = res.ageSeconds;
      box.appendChild(el('div', 'meta',
        'Email diterima ' + (s < 60 ? s + ' detik' : Math.round(s / 60) + ' menit') + ' yang lalu'));
    }
    box.hidden = false;
  }

  /* ---------- Ambil OTP ---------- */
  function requestOtp(service) {
    if (!state.pin || busy[service]) return;

    if (!state.services[service]) {
      showNote('PIN kamu tidak terdaftar untuk layanan ' + LABEL[service] + '.', 'error');
      return;
    }

    busy[service] = true;
    var btn = $('btn-' + service);
    btn.disabled = true;
    btn.querySelector('.sub').textContent = 'Mencari kode...';
    showNote('Mencari kode ' + LABEL[service] + '...', 'info');

    api({ action: 'otp', pin: state.pin, service: service }).then(function (res) {
      busy[service] = false;

      if (res && res.ok) {
        showSuccess(res);
        startCooldown(service, CONFIG.COOLDOWN_SECONDS);
        return;
      }

      showNote((res && res.error) || 'Gagal mengambil kode.', 'error');

      if (res && (res.code === 'COOLDOWN' || res.code === 'NOT_FOUND')) {
        startCooldown(service, res.retryAfter || CONFIG.COOLDOWN_SECONDS);
      } else if (res && /PIN|aktif|masa aktif/i.test(res.error || '') && !/layanan/i.test(res.error || '')) {
        // PIN dicabut / expired di tengah sesi
        store.del(KEY_PIN);
      }
      tickCooldown(service);
    });
  }

  /* ---------- Aplikasi Lainnya ---------- */
  function openSheet() {
    var msg = CONFIG.WA_MESSAGE + (state.pin ? ' PIN saya: ' + state.pin : '');
    $('waLink').href = 'https://wa.me/' + CONFIG.WA_NUMBER + '?text=' + encodeURIComponent(msg);
    $('tgLink').href = 'https://t.me/' + CONFIG.TELEGRAM_USERNAME;
    $('sheet').hidden = false;
  }
  function closeSheet() { $('sheet').hidden = true; }

  /* ---------- Init ---------- */
  function init() {
    $('storeName').textContent = CONFIG.STORE_NAME;
    document.title = CONFIG.STORE_NAME + ' - Portal OTP';

    ['netflix', 'disney'].forEach(function (s) {
      defaultSub[s] = $('btn-' + s).querySelector('.sub').textContent;
      $('btn-' + s).addEventListener('click', function () { requestOtp(s); });
    });

    $('btn-other').addEventListener('click', openSheet);
    $('sheetClose').addEventListener('click', closeSheet);
    $('sheet').addEventListener('click', function (e) { if (e.target === $('sheet')) closeSheet(); });
    $('logoutBtn').addEventListener('click', logout);

    $('pin').addEventListener('input', function () {
      this.value = this.value.toUpperCase().replace(/\s+/g, '');
    });

    $('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var pin = $('pin').value.trim().toUpperCase();
      if (!pin) { setLoginError('Masukkan PIN terlebih dahulu.'); return; }
      doLogin(pin, false);
    });

    // Masuk otomatis bila PIN tersimpan
    var saved = store.get(KEY_PIN);
    if (saved) {
      $('loginBtn').disabled = true;
      $('loginBtn').textContent = 'Memeriksa...';
      doLogin(saved, true);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
