# Panduan Deploy – Portal OTP (PIN → OTP Netflix / Disney+)

Isi paket:

```
otp-portal/
├── web/                 ← di-upload ke GitHub Pages
│   ├── index.html
│   ├── style.css
│   └── script.js        ← ubah CONFIG di bagian atas
├── apps-script/
│   └── Code.gs          ← ditempel ke Google Apps Script
└── PANDUAN.md           ← file ini
```

Urutan pengerjaan: **Gmail Pusat → Google Sheets + Apps Script → Frontend → GitHub Pages → Tes.**

---

## 1. Siapkan Gmail Pusat (Master Inbox)

Pakai 1 akun Gmail khusus (jangan akun pribadi utama). Akun ini juga yang akan memiliki Google Sheets.

### Auto-Forward dari tiap akun Netflix / Disney+

Lakukan di **setiap** akun Gmail jualan (nf1@gmail.com, ds2@gmail.com, dst.):

1. Gmail → ⚙️ Setelan → **Lihat semua setelan** → tab **Penerusan dan POP/IMAP**.
2. **Tambahkan alamat penerusan** → isi alamat Gmail Pusat → Lanjutkan.
3. Gmail Pusat akan menerima email konfirmasi berisi kode/link. Konfirmasi.
4. Kembali ke akun jualan, **jangan pilih "Teruskan salinan semua email"**. Lebih aman pakai filter:
   - Tab **Filter dan Alamat yang Diblokir** → **Buat filter baru**
   - Kolom *Dari*: `netflix.com OR disneyplus.com OR disney.com`
   - Buat filter → centang **Teruskan ke:** (alamat Gmail Pusat) → Buat filter.

> Dengan filter, hanya email Netflix/Disney+ yang diteruskan, jadi inbox pribadi di akun jualan tidak ikut terkirim.

---

## 2. Google Sheets + Apps Script

1. Login ke **Gmail Pusat**, buka <https://sheets.new> (buat spreadsheet baru), beri nama misalnya `Database OTP`.
2. Menu **Ekstensi → Apps Script**.
3. Hapus isi `Code.gs`, **tempel seluruh isi `apps-script/Code.gs`**, lalu simpan (Ctrl+S).
4. Di dropdown fungsi, pilih **`setupAwal`** → klik **Jalankan**.
   - Akan muncul permintaan izin (Gmail & Spreadsheet) → *Review permissions* → pilih akun → *Lanjutan* → *Go to … (unsafe)* → **Allow**.
   - Fungsi ini membuat sheet **Pembeli** (dengan 1 baris contoh) dan sheet **Log**.
5. **Deploy → New deployment** → ikon ⚙️ pilih **Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   - Klik **Deploy**, lalu **salin Web app URL** (berakhiran `/exec`).

> Setiap kali kamu mengubah `Code.gs`, wajib: **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. URL tetap sama.

### Format sheet "Pembeli"

| PIN | Nama | Email_Netflix | Email_Disney | Expired | Status |
|---|---|---|---|---|---|
| WF-K3M9X7QA | Budi | nf1@gmail.com | | 2026-12-19 | Aktif |
| WF-P4T2Z8LC | Sinta | | ds2@gmail.com | 2026-12-05 | Aktif |
| WF-H7R5N2VD | Rina | nf1@gmail.com | ds2@gmail.com | 2026-12-25 | Aktif |

- Kolom boleh dikosongkan bila pembeli tidak membeli layanan itu.
- **Expired** berlaku sampai akhir hari pada tanggal tersebut. Format `yyyy-mm-dd` (dd/mm/yyyy juga terbaca).
- **Status**: tulis `Aktif`. Selain itu (misal `Nonaktif`) = ditolak.
- **Hapus baris contoh** `WF-CONTOH01` sebelum jualan.
- **Gunakan PIN acak 8 karakter** (contoh `WF-K3M9X7QA`), jangan PIN pendek berurutan seperti `WF-8821`. PIN pendek mudah ditebak.

Sheet **Log** otomatis mencatat siapa mengambil OTP apa dan kapan.

---

## 3. Frontend (VS Code)

Buka `web/script.js`, ubah bagian `CONFIG` paling atas:

```js
API_URL: 'https://script.google.com/macros/s/XXXXXXXX/exec',
STORE_NAME: 'Nama Tokomu',
WA_NUMBER: '6281234567890',     // tanpa + dan tanpa 0 di depan
TELEGRAM_USERNAME: 'usernamekamu', // tanpa @
```

Opsional: ubah teks tombol di `index.html` dan warna di `style.css`.

---

## 4. Upload ke GitHub Pages

1. Buat repository baru di GitHub (misal `portal-otp`).
2. Upload isi folder `web/` (`index.html`, `style.css`, `script.js`) ke root repository.
3. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save.**
4. Tunggu 1–2 menit. Link web: `https://USERNAME.github.io/portal-otp/`
5. Kirim link + PIN ke pembeli.

---

## 5. Tes sebelum jualan

1. Buka web → masukkan PIN contoh → pastikan masuk ke dashboard.
2. Di aplikasi Netflix/Disney+, tekan **Kirim Kode**. Tunggu ±10 detik.
3. Klik tombol layanan di web → kode muncul.
4. Cek sheet **Log** terisi.

### Kalau kode tidak muncul

- Cek di Gmail Pusat apakah email dari Netflix/Disney+ **sudah masuk** (forwarding berhasil?).
- Pastikan alamat di kolom `Email_Netflix` / `Email_Disney` **sama persis** dengan alamat tujuan email asli.
- Pola subjek dan link di `Code.gs` bagian `CONFIG.SERVICES` dibuat longgar, tetapi format email Netflix/Disney+ bisa berubah. Bila ada tipe email yang tidak terbaca, ubah `allow`, `linkHints` atau `codeLength` di sana, lalu **deploy ulang**.
- Lihat **Apps Script → Eksekusi (Executions)** untuk pesan error.

---

## 6. Keamanan

- Kode di GitHub Pages memang publik, tetapi **data pembeli, daftar email, dan isi inbox tidak pernah dikirim ke frontend**. Semua pengecekan terjadi di Apps Script.
- Server hanya membalas kode angka / link konfirmasi dari domain resmi Netflix/Disney+, bukan isi email.
- Email dengan subjek reset password, ubah email/sandi, pembayaran, dll. **diblokir** (`CONFIG.BLOCK_SUBJECT`), dan link yang mengandung kata sensitif tidak pernah dikembalikan.
- Cooldown dicek di **server** (15 dtk) dan di web (20 dtk), jadi tidak bisa di-bypass dari browser.
- Proteksi tebak PIN: bila PIN salah ≥ 40 kali dalam 5 menit, login ditutup sementara (ubah di `MAX_FAILED_LOGIN`). Karena Apps Script tidak melihat IP, batas ini bersifat global.
- Selalu pakai **Gmail Pusat khusus**, aktifkan verifikasi 2 langkah, dan jangan bagikan akses Sheets-nya.
