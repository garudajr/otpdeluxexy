/**
 * ============================================================
 *  PORTAL OTP - BACKEND (Google Apps Script)
 * ============================================================
 *  Pasang di: Google Sheets > Extensions (Ekstensi) > Apps Script
 *  Akun Google pemilik Sheets ini = Gmail Pusat (Master Inbox).
 *
 *  Langkah singkat:
 *   1. Tempel seluruh kode ini ke Code.gs
 *   2. Jalankan fungsi  setupAwal()  SATU KALI (beri izin akses Gmail & Sheets)
 *   3. Deploy > New deployment > Web app
 *        Execute as : Me
 *        Who has access : Anyone
 *   4. Salin URL Web App (berakhiran /exec) ke CONFIG.API_URL di index.html
 *
 *  Setiap mengubah kode ini, WAJIB deploy ulang:
 *  Deploy > Manage deployments > Edit (ikon pensil) > Version: New version > Deploy
 *
 *  ATURAN PIN (sekali pakai):
 *   - Begitu kode / link OTP berhasil dikirim ke pembeli, kolom Status PIN itu
 *     otomatis berubah dari "Aktif" menjadi "Nonaktif".
 *   - Untuk mengaktifkan lagi, ubah Status di sheet Pembeli kembali ke "Aktif".
 *   - Mau PIN bisa dipakai berkali-kali? Ubah DEACTIVATE_AFTER_SUCCESS jadi false.
 * ============================================================
 */

const CONFIG = {
  SHEET_PEMBELI: 'Pembeli',
  SHEET_LOG: 'Log',

  STATUS_AKTIF: 'Aktif',
  STATUS_TERPAKAI: 'Nonaktif',

  // true  = PIN otomatis Nonaktif setelah OTP/link berhasil diambil (sekali pakai)
  // false = PIN tetap Aktif sampai tanggal Expired
  DEACTIVATE_AFTER_SUCCESS: true,

  // Email hanya dianggap valid bila masuk dalam rentang ini
  MAX_AGE_MINUTES: 10,

  // Jeda minimal antar permintaan OTP (per PIN + layanan), dicek di server
  COOLDOWN_SECONDS: 15,

  // Perlindungan tebak PIN: bila PIN salah >= batas ini dalam jendela waktu,
  // login ditolak sementara. (Global, karena Apps Script tidak melihat IP.)
  MAX_FAILED_LOGIN: 40,
  FAILED_WINDOW_SECONDS: 300,

  SERVICES: {
    netflix: {
      label: 'Netflix',
      emailColumn: 'Email_Netflix',
      // Hanya cari email dari pengirim ini
      fromQuery: 'from:netflix',
      // Link hanya dikembalikan bila domainnya salah satu dari ini
      allowedHosts: ['netflix.com'],
      // Email harus mengandung salah satu pola ini (subjek + isi).
      // Sengaja sempit: "Kode verifikasimu" (konfirmasi perubahan akun) TIDAK boleh lolos.
      allow: [/masukkan kode ini untuk masuk|enter this code to sign in|sign-?in code|kode masuk|akses sementara|temporary access|household|rumah netflix|travel|perjalanan/i],
      // Jumlah digit kode. Netflix = 4 digit. Kode dengan jumlah lain (mis. 6 digit) diabaikan.
      codeLength: 4,
      // Pola link konfirmasi yang boleh diambil
      linkHints: [/update-primary-location/i, /household/i, /travel\/verify/i, /accountaccess/i, /nftoken=/i]
    },
    disney: {
      label: 'Disney+',
      emailColumn: 'Email_Disney',
      fromQuery: 'from:(disneyplus OR disney OR hotstar)',
      allowedHosts: ['disneyplus.com', 'disney.com', 'bamgrid.com', 'hotstar.com'],
      allow: [/one-?time|passcode|pass code|verification|verifikasi|kode|code|sandi satu kali|sandi sekali pakai|otp/i],
      linkHints: [/verify/i, /confirm/i, /household/i],
      codeLength: 6 // Disney+ = 6 digit
    }
  },

  // Email yang SELALU diblokir (dicek pada subjek). Anti-takeover akun.
  BLOCK_SUBJECT: /reset (your )?password|password (reset|changed|was changed)|atur ulang (kata sandi|sandi)|setel ulang (kata sandi|sandi)|ubah (kata sandi|email|alamat email)|ganti (kata sandi|email)|change (your )?(password|email)|update (your )?(password|email)|email (was )?(changed|updated)|forgot|lupa (kata sandi|sandi)|delete (your )?account|hapus akun|cancel|batalkan|membership|keanggotaan|payment|pembayaran/i,

  // Email yang ISI-nya soal perubahan akun juga SELALU diblokir, walau subjeknya terlihat biasa
  // (contoh nyata: subjek "Kode verifikasimu", isi "Konfirmasikan perubahan akunmu dengan kode ini").
  BLOCK_BODY: /perubahan akun|mengubah informasi akun|informasi akunmu|konfirmasikan perubahan|ubah (kata sandi|email|alamat email|nomor)|ganti (kata sandi|email)|change (to )?(your )?(account|password|email)|confirm (your )?(account )?change|account (change|information)/i,

  // Link yang mengandung kata ini TIDAK PERNAH dikembalikan
  BLOCK_URL: /password|reset|change-?email|email|signup|cancel|membership|payment/i
};

/* ------------------------------------------------------------
 *  SETUP (jalankan sekali dari editor Apps Script)
 * ------------------------------------------------------------ */
function setupAwal() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let sh = ss.getSheetByName(CONFIG.SHEET_PEMBELI);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEET_PEMBELI);
    sh.appendRow(['PIN', 'Nama', 'Email_Netflix', 'Email_Disney', 'Expired', 'Status']);
    sh.appendRow(['WF-CONTOH01', 'Contoh Budi', 'nf1@gmail.com', '', '2026-12-19', 'Aktif']);
    sh.getRange('A:A').setNumberFormat('@');          // PIN sebagai teks
    sh.getRange('E:E').setNumberFormat('yyyy-mm-dd'); // format tanggal
    sh.setFrozenRows(1);
    sh.getRange('1:1').setFontWeight('bold');
  }

  let log = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!log) {
    log = ss.insertSheet(CONFIG.SHEET_LOG);
    log.appendRow(['Waktu', 'PIN', 'Nama', 'Layanan', 'Hasil']);
    log.setFrozenRows(1);
    log.getRange('1:1').setFontWeight('bold');
  }

  // Memicu dialog izin Gmail
  GmailApp.getInboxThreads(0, 1);
  Logger.log('Setup selesai. Sekarang lakukan Deploy > Web app.');
}

/* ------------------------------------------------------------
 *  ENTRY POINT WEB APP
 * ------------------------------------------------------------ */
function doGet() {
  return json_({ ok: true, message: 'Portal OTP API aktif.' });
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const pin = String(req.pin || '').trim().toUpperCase();

    // PIN hanya boleh huruf/angka/strip. Sekaligus mencegah isi aneh masuk ke sheet Log.
    if (!/^[A-Z0-9-]{3,40}$/.test(pin)) {
      addFail_();
      out = { ok: false, error: 'Format PIN tidak valid.' };
    } else if (req.action === 'login') {
      out = handleLogin_(pin);
    } else if (req.action === 'otp') {
      out = handleOtp_(pin, String(req.service || '').toLowerCase());
    } else {
      out = { ok: false, error: 'Permintaan tidak dikenal.' };
    }
  } catch (err) {
    console.error(err);
    out = { ok: false, error: 'Terjadi kesalahan di server. Coba lagi sebentar lagi.' };
  }
  return json_(out);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------
 *  HANDLER: LOGIN
 * ------------------------------------------------------------ */
function handleLogin_(pin) {
  if (isLocked_()) {
    logLockOnce_();
    return { ok: false, error: 'Terlalu banyak percobaan PIN salah. Coba lagi beberapa menit lagi.' };
  }

  const v = validateBuyer_(pin);
  if (!v.ok) {
    if (v.pinNotFound) {
      addFail_();
      log_(pin, '', 'Login', 'PIN salah / tidak ditemukan');
    } else {
      log_(pin, v.nama, 'Login', 'Ditolak: ' + v.reason);
    }
    return { ok: false, error: v.error };
  }

  const b = v.buyer;
  log_(pin, b.nama, 'Login', 'Login berhasil');
  return {
    ok: true,
    name: b.nama,
    services: {
      netflix: !!b.emails.netflix,
      disney: !!b.emails.disney
    }
  };
}

/* ------------------------------------------------------------
 *  HANDLER: AMBIL OTP
 * ------------------------------------------------------------ */
function handleOtp_(pin, service) {
  const svc = CONFIG.SERVICES[service];
  if (!svc) return { ok: false, error: 'Layanan tidak dikenal.' };

  if (isLocked_()) {
    logLockOnce_();
    return { ok: false, error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' };
  }

  // 1) PIN ada + Aktif, 2) belum expired
  const v = validateBuyer_(pin);
  if (!v.ok) {
    if (v.pinNotFound) {
      addFail_();
      log_(pin, '', svc.label, 'Ditolak: PIN tidak ditemukan');
    } else {
      log_(pin, v.nama, svc.label, 'Ditolak: ' + v.reason);
    }
    return { ok: false, error: v.error };
  }
  const b = v.buyer;

  // 3) Email untuk layanan yang diklik harus terisi
  const email = b.emails[service];
  if (!email) {
    log_(pin, b.nama, svc.label, 'Ditolak: layanan tidak terdaftar');
    return { ok: false, error: 'PIN kamu tidak terdaftar untuk layanan ' + svc.label + '.' };
  }

  // Cooldown di sisi server
  const cache = CacheService.getScriptCache();
  const cdKey = 'cd_' + pin + '_' + service;
  const last = Number(cache.get(cdKey) || 0);
  if (last) {
    const left = Math.ceil(CONFIG.COOLDOWN_SECONDS - (Date.now() - last) / 1000);
    if (left > 0) {
      return { ok: false, code: 'COOLDOWN', retryAfter: left,
               error: 'Tunggu ' + left + ' detik sebelum mencoba lagi.' };
    }
  }
  cache.put(cdKey, String(Date.now()), CONFIG.COOLDOWN_SECONDS);

  // Cari email OTP (tanpa lock supaya pembeli lain tidak ikut menunggu)
  const found = findOtp_(email, svc);
  if (!found) {
    log_(pin, b.nama, svc.label, 'Belum ada email kode');
    return {
      ok: false,
      code: 'NOT_FOUND',
      retryAfter: CONFIG.COOLDOWN_SECONDS,
      error: 'Belum ada email kode dalam ' + CONFIG.MAX_AGE_MINUTES +
             ' menit terakhir. Pastikan sudah menekan "Kirim Kode" di aplikasi, tunggu 10 detik, lalu coba lagi.'
    };
  }

  // Kode ketemu. Kunci sebentar, cek ulang PIN, lalu nonaktifkan.
  // Lock mencegah 2 permintaan bersamaan (mis. 2 perangkat) sama-sama lolos.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, error: 'Server sedang sibuk. Coba lagi sebentar lagi.' };
  }
  let deactivated = false;
  let deactivateError = null;
  try {
    const again = validateBuyer_(pin);
    if (!again.ok) {
      log_(pin, b.nama, svc.label, 'Ditolak: ' + (again.reason || 'PIN tidak aktif'));
      return { ok: false, error: again.error };
    }
    if (CONFIG.DEACTIVATE_AFTER_SUCCESS) {
      try {
        deactivate_(again.buyer);
        deactivated = true;
      } catch (err) {
        deactivateError = String(err && err.message || err);
      }
    }
  } finally {
    lock.releaseLock();
  }

  log_(pin, b.nama, svc.label, 'OTP sukses (' + (found.code ? 'kode' : 'link') + ')');
  if (deactivated) log_(pin, b.nama, svc.label, 'PIN dinonaktifkan otomatis');
  if (deactivateError) log_(pin, b.nama, svc.label, 'GAGAL menonaktifkan PIN: ' + deactivateError);

  return {
    ok: true,
    service: service,
    label: svc.label,
    code: found.code || null,
    link: found.link || null,
    ageSeconds: found.ageSeconds,
    deactivated: deactivated
  };
}

function deactivate_(buyer) {
  buyer.sheet.getRange(buyer.row, buyer.statusCol).setValue(CONFIG.STATUS_TERPAKAI);
  SpreadsheetApp.flush(); // pastikan permintaan berikutnya langsung melihat "Nonaktif"
}

/* ------------------------------------------------------------
 *  VALIDASI PEMBELI (membaca Google Sheets)
 * ------------------------------------------------------------ */
function validateBuyer_(pin) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEET_PEMBELI);
  if (!sh) throw new Error('Sheet "' + CONFIG.SHEET_PEMBELI + '" tidak ditemukan. Jalankan setupAwal().');

  const range = sh.getDataRange();
  const values = range.getValues();
  const display = range.getDisplayValues();
  if (values.length < 2) return { ok: false, pinNotFound: true, error: 'PIN tidak ditemukan.' };

  const head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const col = function (name) { return head.indexOf(name.toLowerCase()); };
  const c = {
    pin: col('PIN'), nama: col('Nama'),
    netflix: col(CONFIG.SERVICES.netflix.emailColumn),
    disney: col(CONFIG.SERVICES.disney.emailColumn),
    expired: col('Expired'), status: col('Status')
  };
  if (c.pin < 0 || c.expired < 0 || c.status < 0) {
    throw new Error('Header sheet Pembeli tidak lengkap (PIN, Nama, Email_Netflix, Email_Disney, Expired, Status).');
  }

  const tz = ss.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  for (let r = 1; r < values.length; r++) {
    const rowPin = String(display[r][c.pin]).trim().toUpperCase();
    if (!rowPin || rowPin !== pin) continue;

    const nama = c.nama >= 0 ? String(display[r][c.nama]).trim() : '';

    // Status
    const status = String(display[r][c.status]).trim().toLowerCase();
    if (status !== CONFIG.STATUS_AKTIF.toLowerCase()) {
      return {
        ok: false, nama: nama, reason: 'PIN nonaktif',
        error: 'PIN ini sudah tidak aktif (sudah dipakai atau dinonaktifkan). Hubungi admin untuk diaktifkan kembali.'
      };
    }

    // Expired (berlaku sampai akhir hari tanggal Expired)
    const exp = toIsoDate_(values[r][c.expired], display[r][c.expired], tz);
    if (!exp || exp < today) {
      return {
        ok: false, nama: nama, reason: 'PIN expired',
        error: 'Masa aktif PIN kamu sudah habis. Hubungi admin untuk perpanjang.'
      };
    }

    const mail = function (idx) {
      return idx < 0 ? '' : String(display[r][idx]).trim().toLowerCase();
    };
    return {
      ok: true,
      buyer: {
        nama: nama,
        emails: { netflix: mail(c.netflix), disney: mail(c.disney) },
        sheet: sh,
        row: r + 1,            // nomor baris di sheet (1-based)
        statusCol: c.status + 1 // nomor kolom Status (1-based)
      }
    };
  }
  return { ok: false, pinNotFound: true, error: 'PIN tidak ditemukan. Periksa kembali PIN kamu.' };
}

function toIsoDate_(value, displayValue, tz) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }
  const s = String(displayValue || value || '').trim();
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
  if (m) return m[3] + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);
  return null; // tidak terbaca => dianggap expired (aman)
}

function pad2_(n) { return ('0' + n).slice(-2); }

/* ------------------------------------------------------------
 *  PENCARIAN OTP DI GMAIL PUSAT
 * ------------------------------------------------------------ */
function findOtp_(email, svc) {
  const cutoff = new Date(Date.now() - CONFIG.MAX_AGE_MINUTES * 60 * 1000);
  const afterEpoch = Math.floor(cutoff.getTime() / 1000);
  const query = 'to:' + email + ' ' + svc.fromQuery + ' after:' + afterEpoch;

  const threads = GmailApp.search(query, 0, 10);
  const msgs = [];
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      if (m.getDate() >= cutoff) msgs.push(m);
    });
  });
  msgs.sort(function (a, b) { return b.getDate() - a.getDate(); }); // terbaru dulu

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];

    // Pastikan benar-benar ditujukan ke email tersebut
    const addrs = ((m.getTo() || '') + ' ' + (m.getCc() || '')).toLowerCase()
      .match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g) || [];
    if (addrs.indexOf(email) === -1) continue;

    const subject = m.getSubject() || '';

    // Filter keamanan: blokir reset password / ubah email, dll.
    if (CONFIG.BLOCK_SUBJECT.test(subject)) continue;

    const body = getText_(m);
    const text = subject + '\n' + body;
    if (CONFIG.BLOCK_BODY.test(text)) continue; // email perubahan akun: jangan pernah diambil
    if (!svc.allow.some(function (rx) { return rx.test(text); })) continue;

    const code = extractCode_(body, svc);
    const link = extractLink_(body, svc);
    if (!code && !link) continue;

    return {
      code: code,
      link: link,
      ageSeconds: Math.max(0, Math.round((Date.now() - m.getDate().getTime()) / 1000))
    };
  }
  return null;
}

function getText_(m) {
  let t = m.getPlainBody() || '';
  if (!t.trim()) {
    t = (m.getBody() || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|h\d|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  }
  // Buang karakter tak terlihat yang sering disisipkan di email HTML
  return t.replace(/[​-‏⁠﻿͏]/g, '');
}

function extractCode_(text, svc) {
  // Spasi khusus (nbsp dll.) dijadikan spasi biasa, URL dibuang
  const clean = text
    .replace(/[   ]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ');

  // Jumlah digit harus TEPAT sama dengan layanan (Netflix 4, Disney+ 6).
  // Kode dengan jumlah digit lain (mis. 6 digit "konfirmasi perubahan akun" Netflix) diabaikan.
  const N = svc.codeLength;

  // 1) Baris yang isinya hanya kode: "9578", "9 5 7 8" (Netflix ID), atau "123 456"
  const lines = clean.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\s+/g, ' ').trim();
    if (/^\d(?: ?\d)*$/.test(l) && l.replace(/ /g, '').length === N) return l.replace(/ /g, '');
  }

  // 2) Angka tepat setelah kata kunci (code / kode / passcode / otp / sandi / akses),
  //    dengan jumlah digit tepat N dan tidak menempel ke angka lain.
  const flat = clean.replace(/[ \t]+/g, ' ');
  const KW = '(?:code|kode|passcode|otp|sandi|access|akses)[^\\d]{0,80}?';
  const kwSpaced = flat.match(new RegExp(KW + '(?<!\\d)(?<!\\d )(\\d(?: \\d){' + (N - 1) + '})(?!\\d)(?! \\d)', 'i'));
  if (kwSpaced) return kwSpaced[1].replace(/ /g, '');
  const kw = flat.match(new RegExp(KW + '(?<!\\d)(\\d{' + N + '})(?!\\d)(?! \\d)', 'i'));
  if (kw) return kw[1];

  // Sengaja TIDAK menebak angka sembarang (bisa salah ambil nomor telepon / tahun di footer).
  // PIN sekali pakai: lebih baik "belum ada kode" daripada kode salah yang menghanguskan PIN.
  return null;
}

function extractLink_(text, svc) {
  const urls = (text.match(/https?:\/\/[^\s"'<>\)\]]+/g) || [])
    .map(function (u) { return u.replace(/&amp;/g, '&').replace(/[.,;]+$/, ''); });

  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    const h = u.match(/^https?:\/\/([^\/?#:]+)/i);
    if (!h) continue;
    const host = h[1].toLowerCase();
    const hostOk = svc.allowedHosts.some(function (d) { return host === d || host.endsWith('.' + d); });
    if (!hostOk) continue;
    if (CONFIG.BLOCK_URL.test(u.replace(/^https?:\/\/[^\/]+/i, ''))) continue; // cek path+query saja
    if (svc.linkHints.some(function (rx) { return rx.test(u); })) return u;
  }
  return null;
}

/* ------------------------------------------------------------
 *  THROTTLE LOGIN & LOG
 * ------------------------------------------------------------ */
function isLocked_() {
  return Number(CacheService.getScriptCache().get('fails') || 0) >= CONFIG.MAX_FAILED_LOGIN;
}
function addFail_() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('fails') || 0) + 1;
  cache.put('fails', String(n), CONFIG.FAILED_WINDOW_SECONDS);
}
// Catat pemblokiran cukup sekali per jendela waktu supaya Log tidak dibanjiri
function logLockOnce_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('lock_logged')) return;
  cache.put('lock_logged', '1', CONFIG.FAILED_WINDOW_SECONDS);
  log_('(banyak PIN)', '', 'Login', 'DIBLOKIR sementara: terlalu banyak PIN salah');
}

function safe_(v) {
  v = String(v == null ? '' : v);
  // Awalan = + - @ bisa dibaca Sheets sebagai rumus; apostrof memaksanya jadi teks
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

function log_(pin, nama, layanan, hasil) {
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_LOG);
    if (sh) sh.appendRow([new Date(), safe_(pin), safe_(nama), safe_(layanan), safe_(hasil)]);
  } catch (e) { /* log tidak boleh menggagalkan permintaan */ }
}
