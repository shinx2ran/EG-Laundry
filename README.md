# EG Laundry — Aplikasi Kasir Laundry (gratis, online, Android & iPhone)

EG Laundry adalah aplikasi web progresif (PWA) untuk laundry EG: pesanan, pelanggan (anak kos EG Kost dan umum),
daftar harga, dan laporan. Dibangun dari kerangka aplikasi kos [Woombad](https://github.com/shinx2ran/Woombad), tetapi
berdiri sendiri: repo, database, dan data di HP terpisah.

- **Pesanan**: cucian masuk per kg / per potong, express, paket prabayar; status Diterima → Proses → Siap diambil →
  Diambil; lunas / belum bayar (lihat `docs/SPEC.md` bagian 3).
- **Dashboard**: masuk hari ini, sedang proses (yang terlambat merah), siap diambil dengan tombol WhatsApp dan Diambil,
  belum bayar, uang masuk hari ini.
- **Pelanggan**: anak kos EG Kost ditandai (impor dari cadangan Woombad), riwayat dan frekuensi cuci, pesan WhatsApp
  "cucian siap diambil".
- **Laporan**: uang masuk harian/bulanan, pesanan per layanan, anak kos vs umum, pelanggan, pelanggan yang lama tidak
  datang dengan tombol **Kirim promo**; unduh XLSX / CSV.
- **Online & multi-perangkat**: login email + kata sandi, data di Supabase (gratis), anggota baru bergabung dengan
  **kode undangan**. Bisa di-"install" ke layar utama seperti aplikasi biasa.

> Tanpa konfigurasi Supabase aplikasi berjalan dalam **Mode Demo** (data hanya di browser ini). Itu keadaan saat ini:
> alamat aplikasi sudah ada, tetapi database online belum dibuat (lihat [Peluncuran online](#peluncuran-online)).

## Biaya

| Komponen | Layanan | Biaya |
|---|---|---|
| Database, login, penyimpanan logo | Supabase Free | Rp 0 (500 MB DB, 1 GB storage) |
| Hosting web (PWA) | GitHub Pages | Rp 0 |

Catatan jujur: paket gratis Supabase **tidak membuat cadangan otomatis**, dan proyek **dijeda bila sepekan terlalu
sedikit permintaan**. GitHub Actions memanggil database 3× sehari (`keepalive.yml`) dan membuat cadangan terenkripsi
tiap minggu (`backup.yml`); keduanya mulai bekerja setelah go-live.

## Menjalankan secara lokal

```bash
npm install
npm run dev        # http://localhost:5173  (Mode Demo bila .env tidak ada / kosong)
npm test           # unit test
npm run typecheck
npm run lint
npm run build      # hasil di dist/
npm run e2e        # uji Playwright (Mode Demo) terhadap hasil build
node scripts/check-public-config.mjs   # memastikan .env.production tidak memuat kunci rahasia
```

## Alamat aplikasi

Setiap perubahan di cabang `master` otomatis dibangun dan dipublikasikan oleh GitHub Actions ke
**https://shinx2ran.github.io/EG-Laundry/**. Selama `.env.production` kosong, alamat ini berjalan dalam Mode Demo;
setelah [peluncuran online](#peluncuran-online) alamat yang sama menjadi mode online.

## Peran anggota

| Peran | Untuk | Boleh |
|---|---|---|
| **Pemilik** | Akun pertama | Semua, termasuk mengubah peran anggota dan menghapus admin. |
| **Admin** | Pasangan | Semua data: daftar harga, pesanan, pelanggan, koreksi, Laporan, undang anggota, cadangan, Riwayat perubahan. Tidak bisa mengubah peran anggota. |
| **Staf** | Kasir / pegawai | Catat pesanan, pelanggan, pembayaran, jual paket; ubah pesanan **sampai Selesai**. **Tidak bisa** menghapus pesanan, mengubah/menghapus pembayaran, mengubah daftar harga atau katalog paket, menghapus pelanggan, atau impor penyewa. Tidak melihat **Laporan**, **Anggota**, **Data** (cadangan) dan **Riwayat perubahan**. |

Batasan dijaga oleh database (Row Level Security), bukan hanya oleh tampilan aplikasi (`docs/SPEC.md` bagian 3.10).

## Pemakaian sehari-hari

| Kejadian | Di aplikasi |
|---|---|
| Pelanggan datang membawa cucian | Dashboard → **+ Pesanan baru** → pilih/tambah pelanggan, isi layanan dan berat → **Simpan pesanan** → **Kirim struk WhatsApp** |
| Cucian selesai | Buka pesanan → **Siap diambil** → **Kabari: siap diambil** (WhatsApp) |
| Cucian diambil | Dashboard → Siap diambil → **Diambil**; bila masih ada sisa, dialog yang sama menawarkan **Terima pembayaran** (pelunasan) |
| Pelanggan membeli paket prabayar | **Pelanggan** → pilih pelanggan → **Jual paket**; pesanan berikutnya menawarkan "Pakai paket" |
| Promo untuk pelanggan yang lama tidak datang | **Laporan** → **Lama tidak datang** → **Kirim promo** (teks dari Pengaturan → Pesan WhatsApp) |
| Menandai anak kos EG Kost | **Pengaturan** → **Impor penyewa dari Woombad** → pilih berkas cadangan Woombad → periksa pratinjau → **Terapkan** |

## Pindah ke online

Selama `.env.production` kosong, aplikasi berjalan dalam Mode Demo. Langkah go-live ada di
[Peluncuran online](#peluncuran-online); data yang sudah dicatat di Mode Demo dibawa lewat **Unduh cadangan JSON**
(langkah 1) lalu **Pengaturan → Pindahkan data Mode Demo ke online** (langkah 5).

## Peluncuran online

Kerjakan berurutan, sekali saja, **setelah** modul laundry selesai dan dicoba di Mode Demo:

| # | Siapa | Apa |
|---|---|---|
| 1 | Pemilik | Simpan data Mode Demo bila ada yang mau disimpan (**Pengaturan → Data → Unduh cadangan JSON**) |
| 2 | Operator (Claude) | Buat proyek Supabase (Free, region Singapore); **SQL Editor** → jalankan seluruh `supabase/schema.sql`; `node scripts/new-setup-code.mjs` → jalankan `select public.set_setup_code('…')`; isi `.env.production` dengan **Project URL** dan **Publishable key** (`sb_publishable_…`); `node scripts/check-public-config.mjs`; commit ke `master`. Isi `PGUSER` di `backup.yml` (`eg_laundry_backup.<project-ref>`) dan beri tahu kata sandi role cadangan untuk rahasia `BACKUP_DB_PASSWORD`. |
| 3 | Pemilik | Dashboard Supabase → **Authentication**: *Confirm email* **OFF**; *Minimum password length* 8; **Site URL** `https://shinx2ran.github.io/EG-Laundry/`; **Redirect URL** `https://shinx2ran.github.io/EG-Laundry/reset-sandi`. |
| 4 | Pemilik | Buka alamat aplikasi → **Buat akun** (email sama dengan akun Supabase) → **Masukkan kode** → kode pemilik → **Gabung**. |
| 5 | Pemilik | Bila ada data Mode Demo yang mau dibawa: **Pengaturan → Pindahkan data Mode Demo ke online** → pilih berkas dari langkah 1 (hanya selama laundry online belum punya pesanan; data contoh Mode Demo tertinggal kecuali "Sertakan data contoh Mode Demo" dinyalakan). |
| 6 | Pemilik + staf | **Pengaturan → Anggota → Undang** → pilih peran → **Kirim lewat WhatsApp**. Penerima membuat akun lewat tautan itu. |
| 7 | Pemilik | Repo → **Settings → Secrets → Actions**: `BACKUP_DB_PASSWORD`. Aktifkan 2FA di GitHub dan Supabase. |

### Mana yang rahasia?

| Hal | Rahasia? |
|---|---|
| Project URL + *Publishable key* (`sb_publishable_…`) | Tidak: ikut di dalam aplikasi; data dilindungi Row Level Security. |
| *Secret key* (`sb_secret_…`) / *service_role key* | **Ya, sangat.** Jangan dikirim, ditempel, atau di-commit. Build gagal bila ada di `.env.production`. |
| Kata sandi database, kata sandi role cadangan | Ya; simpan di pengelola sandi. |
| Kode pemilik, kode undangan | Ya, sampai dipakai (sekali pakai; undangan berlaku 7 hari). |

### Perawatan rutin (setelah go-live)

| Kapan | Apa |
|---|---|
| Otomatis, 3× sehari | **Keep database awake** memanggil `keepalive()` agar proyek gratis tidak dijeda. |
| Otomatis, Minggu malam | **Weekly encrypted backup** (90 hari, terenkripsi dengan kunci `age` pemilik). |
| Sebulan sekali | **Pengaturan → Data → Unduh cadangan lengkap (JSON)**, simpan sendiri. |
| Email GitHub: workflow gagal / dimatikan | Proyek dijeda → dashboard Supabase → **Resume project**. Jadwal dimatikan setelah 60 hari tanpa commit → **Actions → Enable workflow**. |
| Lupa kata sandi | Pemilik: **Lupa kata sandi?** di layar Masuk. Anggota lain: operator membuat kata sandi sementara (`node scripts/temp-password.mjs <email>`), lalu **Pengaturan → Tentang → Ganti kata sandi**. |

## Menguji skema database secara lokal (opsional)

`PSQL="psql -h localhost -U postgres" supabase/tests/run.sh` (PostgreSQL ≥ 15 dengan `dblink`). CI menjalankannya
pada setiap push.

## Install ke HP

Android (Chrome): menu ⋮ → **Tambahkan ke layar utama**. iPhone (Safari): **Bagikan** → **Tambahkan ke Layar
Utama**. Petunjuk yang sama ada di **Pengaturan → Pasang di HP**.

## Struktur proyek

`src/app` (kerangka, rute), `src/components/ui`, `src/hooks` (auth, organisasi, tabel), `src/lib` (repo adapter,
format, auth), `src/features/<modul>` (auth, settings, dashboard, pesanan, pelanggan, harga, laporan),
`supabase/schema.sql` + `supabase/tests`, `e2e/` (Playwright), `docs/SPEC.md`.

## Lisensi

MIT.
