# EG Laundry — Spesifikasi

Aplikasi web progresif (PWA) untuk kasir dan pelanggan laundry EG. Dibangun dari kerangka aplikasi kos Woombad
(login, keanggotaan berbasis kode, riwayat perubahan, cadangan, Mode Demo) dengan modul laundry sendiri. Kedua
aplikasi berdiri sendiri: repo, database Supabase, dan penyimpanan browser masing-masing.

## 1. Tujuan

- **Kasir laundry** di HP: catat pesanan masuk (per kg, per potong, express, paket prabayar), status cucian
  (Diterima → Proses → Siap diambil → Diambil), dan pembayaran (lunas / belum).
- **Pelanggan**: anak kos EG Kost dan pelanggan umum, dengan riwayat dan frekuensi cuci per pelanggan, supaya pemilik
  dapat membuat promosi per pelanggan (mis. anak kos yang sudah 3 minggu tidak mencuci).
- **Dua peran**: pemilik (semua) dan staf/kasir (catat pesanan & pelanggan; tidak mengubah harga, tidak melihat
  laporan). Admin = seperti pemilik tanpa mengatur peran.
- **Online** (Supabase, gratis) agar pemilik dan staf memakai HP masing-masing; **Mode Demo** (data di browser) untuk
  mencoba sebelum go-live. Biaya Rp 0 (Supabase Free + GitHub Pages).
- Tautan ke EG Kost hanya lewat **impor daftar penyewa** dari cadangan Woombad (dicocokkan dengan nomor HP), bukan
  berbagi database.

## 2. Arsitektur & keamanan

Satu laundry = satu organisasi. Semua baris data memuat `org_id`; Row Level Security `is_org_member(org_id)`
(perubahan harga dan koreksi: `is_org_admin`). Klien React + TanStack Query; dua adapter data (`SupabaseRepo` untuk
Mode Online, `LocalRepo` di localStorage untuk Mode Demo) dengan API yang sama (`src/lib/repo`). Logika bisnis adalah
fungsi murni yang diuji dengan Vitest; alur layar diuji dengan Playwright di viewport HP.

### 2.1 Keanggotaan berbasis kode (tanpa email)
- **Kode** = 8 karakter dari alfabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (tanpa 0/O/1/I/L), ditampilkan `ABCD-EFGH`.
  Klien menormalkan (`normalizeCode`) sebelum dikirim; server hanya menyimpan hash SHA-256 (fungsi bawaan Postgres).
- **Kode pemilik (setup code)**: tabel `public.app_settings` (satu baris). Diisi operator lewat
  `select public.set_setup_code('ABCD-EFGH')`; fungsi ini hanya untuk `service_role`. Tabel tanpa policy dan tanpa
  grant: tak terbaca klien.
- Pendaftaran akun **tidak** memberi akses apa pun. `ensure_membership()` hanya mengembalikan keanggotaan yang ada;
  bila tidak ada: SQLSTATE `WB001` → layar **Masukkan kode**.
- `join_with_code(p_code)`: batas 10 kegagalan per jam per akun (`join_attempts`); kode undangan yang cocok (belum
  dipakai, belum kedaluwarsa, pembuatnya masih pemilik/admin) → anggota baru; kode pemilik yang belum dipakai dan belum
  ada organisasi → organisasi "EG Laundry" + pemilik. Kode salah → `null` (kegagalan dicatat), bukan exception.
- `create_invitation(org, role, label)`: admin saja; role `admin`/`staff`; berlaku 7 hari; maksimal 20 kode aktif;
  hash disimpan di `invitation_codes` (tanpa grant/policy, tidak ikut cadangan). `set_member_role`: pemilik saja,
  pemilik terakhir tidak bisa diturunkan. `remove_member`: admin tidak dapat menghapus pemilik/admin lain; kode yang
  dibuat orang yang dihapus/diturunkan berhenti berlaku.
- Tidak ada update/insert/delete langsung ke `organization_members` lewat API.

### 2.2 Pembatasan staf (ditegakkan database)
- Ditulis bersama modul laundry (bagian 3): daftar harga dan paket hanya admin; pesanan & pelanggan boleh ditambah
  staf; koreksi/hapus pesanan dan pembayaran hanya admin; `created_by` diisi dari `auth.uid()`; `org_id` tidak bisa
  dipindah (`keep_org_id`). UI menyembunyikan aksi yang ditolak dan menampilkan pesan `translateDbError` bila server
  menolak.

### 2.3 Riwayat perubahan (audit log)
- Tabel `public.audit_log` (org_id, table_name, row_id, action, changed_by, changed_at, old_data, new_data), indeks
  `(org_id, changed_at desc)`. Trigger AFTER INSERT/UPDATE/DELETE (security definer) pada `organizations,
  organization_members, invitations` + setiap tabel laundry. Update tanpa perubahan tidak dicatat.
- RLS: `select` untuk `is_org_admin(org_id)`; tidak ada policy tulis; `grant select` saja. Tak seorang pun dapat
  mengubah/menghapus riwayat lewat API.
- UI: Pengaturan → **Riwayat perubahan** (100 terakhir) dan `RecordHistory` di bawah dialog ubah (per baris).
  Mode Demo tidak mencatat riwayat (dijelaskan di kartu).

### 2.4 Satu berkas skema
- `supabase/schema.sql` adalah versi lengkap: berjalan pada database kosong dan aman dijalankan ulang. Diuji di
  `supabase/tests` (skenario `fresh` dan `twice`; `run.sh`), termasuk struktur & hak akses (`zz.check_structure`).

### 2.5 Penyimpanan foto
- Bucket privat `logos` (1 MB, png/jpeg/webp) untuk logo laundry: path `<org_id>/<file>`; anggota membaca (signed
  URL), admin menulis. Aplikasi menghapus baris dulu, lalu berkas lewat Storage API.

### 2.6 Cadangan & Mode Demo
- Pengaturan → Data (online, owner/admin): **Unduh cadangan lengkap (JSON)** — format
  `{ version: 1, exportedAt, orgName, tables: { <tabel>: Row[] } }`. Cadangan terenkripsi otomatis tiap minggu
  (`backup.yml`, role `eg_laundry_backup` yang hanya bisa `export_backup()`), aktif setelah rahasia
  `BACKUP_DB_PASSWORD` dan `PGUSER` diisi saat go-live.
- Mode Demo: **Unduh / Pulihkan dari JSON** (validasi zod, unduh otomatis sebelum menimpa), **Reset data demo**,
  pengingat cadangan > 7 hari, `navigator.storage.persist()`, layar galat bila data perangkat rusak.
- Penyimpanan browser memakai awalan `eglaundry.` sehingga tidak bercampur dengan aplikasi kos di HP yang sama.

### 2.7 Konfigurasi publik untuk build
- `.env.production` (di-commit) memuat URL Supabase & *publishable key* (`sb_publishable_…`) — publik, dilindungi RLS.
  Kosong = Mode Demo (keadaan sebelum go-live). `scripts/check-public-config.mjs` menolak kunci rahasia. CI membangun
  Mode Demo agar e2e tidak bergantung pada database live; deploy ke GitHub Pages (`/EG-Laundry/`).
- Workflow `keepalive.yml` (3× sehari) dan `backup.yml` (mingguan) tidak melakukan apa-apa selama belum go-live.

## 3. Domain laundry

(ditulis terpisah)
