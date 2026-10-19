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
- Tabel peran ada di **3.10**: daftar harga dan katalog paket hanya admin (RLS update/delete); pesanan, item,
  pelanggan, paket terjual dan pembayaran boleh ditambah staf; hapus pesanan/pelanggan/paket, ubah pesanan yang
  sudah Selesai/Dibatalkan (`orders_done_guard`) dan ubah/hapus pembayaran hanya admin; `created_by` diisi dari
  `auth.uid()`; `org_id` tidak bisa dipindah (`keep_org_id`). Aturan yang sama diperiksa di aplikasi (hook aksi
  menolak sebelum menulis; UI menyembunyikan aksi) dan `translateDbError` menampilkan pesan server bila ditolak.

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
  `supabase/tests` (skenario `fresh` dan `twice`; `run.sh`), termasuk struktur & hak akses (`zz.check_structure`)
  dan aturan domain laundry (`20-laundry.sql`: batasan staf, isolasi antar organisasi, trigger, riwayat, cadangan).

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

Semua uang dalam rupiah bulat (`bigint`), jumlah kg dengan 2 desimal (`numeric(8,2)`), pcs bilangan bulat. Tanggal `date`
(WIB), waktu `timestamptz`. Setiap tabel punya `org_id` (RLS seperti bagian 2), `created_at`, `updated_at` (kecuali
disebut lain). Mode Demo menyimpan tabel yang sama di browser (`LocalRepo`), jadi semua aturan di bawah dihitung di
aplikasi; di Mode Online aturan yang sama juga dijaga database (check constraint / trigger / RLS).

### 3.1 Layanan & harga (`services`)
| Kolom | Isi |
|---|---|
| `name` | Cuci kering, Cuci setrika, Setrika saja, Bed cover, Selimut, Sepatu, … |
| `unit` | `'kg'` atau `'pcs'` |
| `price` | harga reguler per unit |
| `price_express` | harga express per unit, `null` = layanan ini tidak ada express |
| `days_regular`, `days_express` | lama pengerjaan (hari) reguler / express; dipakai untuk perkiraan selesai |
| `min_qty` | minimal pesanan (mis. 2 kg); 0 = tidak ada |
| `sort_order`, `active` | urutan di form; `active=false` disembunyikan dari form baru tanpa menghapus riwayat |

- Hanya pemilik/admin yang boleh mengubah daftar harga (RLS update/delete admin-only). Staf hanya membaca.
- Harga lama tidak diubah di pesanan yang sudah ada: `order_items` menyimpan salinan nama, unit dan harga (3.3).

### 3.2 Pelanggan (`customers`)
| Kolom | Isi |
|---|---|
| `name` | wajib |
| `phone` | opsional; disimpan apa adanya, dicocokkan lewat `normalizePhone` (+62…) |
| `is_tenant` | **Anak kos**: pelanggan ini penyewa EG Kost |
| `room_name` | kamar (teks, mis. "B3"), hanya bermakna bila `is_tenant` |
| `kos_tenant_id` | id penyewa di Woombad hasil impor (3.8); dipakai untuk mencocokkan ulang walau nomor HP berubah |
| `address`, `notes` | opsional |

- Pelanggan tidak bisa dihapus bila sudah punya pesanan/paket (FK restrict → pesan "masih dipakai"); cukup biarkan.
- Daftar pelanggan: cari nama/HP, filter **Semua / Anak kos / Umum**; tiap baris: nama, HP (tautan WhatsApp), badge
  "Anak kos · B3", kunjungan terakhir, jumlah pesanan.
- Di form pesanan, pelanggan baru bisa ditambahkan langsung dengan nama saja (HP boleh menyusul; tombol ➕ HP seperti
  di Woombad).

### 3.3 Pesanan (`orders`, `order_items`)
**orders**
| Kolom | Isi |
|---|---|
| `order_number` | `LD-YYYYMM-NNNN` per organisasi per bulan, unik `(org_id, order_number)`; nomor ganda (dua HP bersamaan) → ulangi dengan nomor berikutnya, seperti nomor tagihan Woombad |
| `customer_id` | wajib |
| `received_at` | tanggal masuk (default hari ini) |
| `promised_at` | perkiraan selesai = `received_at` + maks(`days_express` bila express, selain itu `days_regular`) dari semua item; bisa diubah |
| `express` | satu saklar untuk seluruh pesanan; item memakai `price_express` layanannya (layanan tanpa harga express → ditolak: "Layanan X tidak ada harga express") |
| `status` | `received` Diterima → `processing` Proses → `ready` Siap diambil → `done` Selesai; `cancelled` Dibatalkan |
| `ready_at`, `picked_up_at` | waktu ditandai siap / diambil |
| `discount` | potongan rupiah ≥ 0, ≤ subtotal |
| `notes` | catatan (noda, tas, dsb.) |

**order_items**
| Kolom | Isi |
|---|---|
| `order_id`, `service_id` | `service_id` boleh `null` bila layanannya dihapus kemudian |
| `service_name`, `unit`, `unit_price` | **salinan** saat pesanan dibuat (sudah harga express bila pesanan express; 0 bila memakai paket) |
| `qty` | > 0; kg 2 desimal, pcs bulat |
| `line_total` | `round(qty × unit_price)` |
| `customer_package_id` | bila kg/pcs diambil dari paket prabayar (3.4): `unit_price` dan `line_total` = 0 |
| `notes` | opsional |

**Perhitungan** (`domain/pricing.ts`, murni, diuji): `subtotal = Σ line_total`, `total = subtotal − discount`,
`paid = Σ payments.amount`, `outstanding = max(0, total − paid)`, status bayar: `lunas` (outstanding 0 dan total > 0 atau
total 0), `sebagian` (paid > 0), `belum`. Tidak ada kolom total/status bayar yang disimpan: semuanya diturunkan dari
baris, supaya tidak pernah tidak sinkron (beda dari Woombad yang menyimpan status tagihan).

**Alur status** (aksi di halaman pesanan dan Dashboard):
- Diterima → **Mulai proses** (opsional) → Proses → **Siap diambil** (boleh langsung dari Diterima; mengisi `ready_at`,
  menawarkan pesan WhatsApp "cucian siap diambil") → Siap → **Diambil** (mengisi `picked_up_at`, status `done`; bila
  masih ada sisa bayar, dialog yang sama menawarkan **Terima pembayaran** sisa itu).
- **Batalkan** hanya dari Diterima/Proses dan hanya bila belum ada pembayaran (hapus pembayarannya dulu — admin).
- Ubah item/qty/diskon/catatan boleh selama belum `done`/`cancelled`; setelah itu hanya pemilik/admin (trigger
  `orders_done_guard` online).
- Hapus pesanan: pemilik/admin saja (RLS); item dan pembayarannya ikut terhapus (cascade), paket yang dipakai kembali
  tersedia karena sisa paket dihitung dari item.

### 3.4 Paket prabayar (`package_catalog`, `customer_packages`)
- **Katalog** (admin): `name` ("Paket 20 kg cuci setrika"), `service_id`, `qty`, `price`, `valid_days` (null = tanpa
  kedaluwarsa), `active`.
- **Pembelian** (`customer_packages`): `customer_id`, `catalog_id` (null bila paket dihapus), salinan `name`,
  `service_id`, `qty_total`, `price`, `purchased_at`, `expires_at` (= purchased + valid_days), `method`
  (`cash|transfer|qris`), `notes`. Pembelian dicatat sebagai **uang masuk** pada `purchased_at`.
- **Sisa** = `qty_total − Σ order_items.qty` (item dengan `customer_package_id` ini pada pesanan yang tidak dibatalkan),
  dihitung saat dibaca. Item pesanan hanya boleh memakai paket pelanggan yang sama, layanan yang sama, belum kedaluwarsa
  pada `received_at`, dan `qty ≤ sisa` (ditolak kalau tidak).
- Di form pesanan: bila pelanggan punya paket aktif untuk layanan yang dipilih, baris item menawarkan "Pakai paket
  (sisa 12,5 kg)".

### 3.5 Pembayaran (`payments`)
| Kolom | Isi |
|---|---|
| `order_id`, `amount` (> 0), `paid_at` (tanggal), `method` (`cash|transfer|qris`), `notes`, `created_by` |

- Boleh DP saat pesanan masuk dan pelunasan saat diambil; `amount ≤ outstanding` (tidak ada lebih bayar).
- Ubah/hapus pembayaran: pemilik/admin (RLS), dengan riwayat perubahan seperti Woombad 7.5.
- **Omzet (uang masuk)** = Σ `payments.amount` per `paid_at` + Σ `customer_packages.price` per `purchased_at`.
  **Piutang** = Σ outstanding pesanan yang belum dibatalkan. Dua angka ini yang dipakai Dashboard dan Laporan.

### 3.6 Dashboard (hari ini)
- Angka: pesanan masuk hari ini (jumlah, kg, nilai), sedang proses, **siap diambil** (daftar: nama, nomor, sisa bayar,
  tombol WhatsApp + Diambil), **belum bayar** (jumlah, rupiah), uang masuk hari ini.
- Tombol besar **+ Pesanan baru**. Pesanan terlambat (`promised_at` < hari ini dan belum siap) ditandai merah.

### 3.7 Laporan (pemilik/admin; staf tidak melihat menu ini)
Rentang hari / minggu / bulan / tahun / khusus (seperti Woombad):
- **Uang masuk** per hari (grafik) dan total; **pesanan** (jumlah, kg, pcs, nilai) per layanan.
- **Anak kos vs umum**: jumlah pesanan, kg, rupiah, dan persentasenya.
- **Pelanggan**: tiap pelanggan dengan kunjungan terakhir, jumlah pesanan 30 / 90 hari, kg, rupiah, badge Anak kos;
  urut dari yang paling sering; filter Anak kos / Umum; tombol **Kirim promo** (WhatsApp) per baris.
- **Lama tidak datang**: pelanggan yang kunjungan terakhirnya > N hari (N bawaan 21, bisa diubah) — target promosi.
- **Template promo** disimpan di organisasi (`organizations.promo_template`, teks dengan `{nama}`), diisi sekali, dipakai
  semua tombol Kirim promo. Unduh XLSX / CSV untuk setiap tabel.

### 3.8 Impor penyewa dari Woombad (Pengaturan → Impor penyewa, pemilik/admin)
- Masukan: berkas cadangan Woombad (JSON `{version:1, tables:{tenants, leases, rooms, …}}`, satu atau beberapa
  organisasi). Tidak ada sambungan ke database kos: berkas diunggah dari HP, dibaca di browser, lalu hasilnya disimpan ke
  database laundry sendiri.
- Untuk setiap penyewa dengan sewa aktif (status `active`): cocokkan pelanggan laundry lewat `kos_tenant_id`, lalu lewat
  `normalizePhone(phone)`. Cocok → set `is_tenant=true`, `room_name` = kamar sewa aktif, simpan `kos_tenant_id`.
  Tidak cocok → (centang, bawaan hidup) buat pelanggan baru dari nama + HP + kamar. Penyewa yang sewanya sudah berakhir
  dan sebelumnya ditandai anak kos → `is_tenant=false` (room dikosongkan), kecuali centang "jangan ubah yang lama".
- Pratinjau sebelum menyimpan: N cocok (diperbarui), N baru, N dinonaktifkan, N tanpa HP (hanya cocok lewat
  `kos_tenant_id`). Fungsi murni `planTenantImport()` dengan unit test; penyimpanan lewat repo biasa (audit log mencatat).

### 3.9 Pesan WhatsApp (`domain/messages.ts`, murni, diuji)
- **Struk masuk**: "Halo {nama}, terima kasih sudah mencuci di {laundry}. Pesanan {nomor} ({tgl masuk}): {daftar item}.
  Total Rp X{, DP Rp Y}. Perkiraan selesai {tgl}." + footer organisasi (`organizations.wa_footer`, mis. jam buka).
- **Siap diambil**: "Halo {nama}, cucian Anda di {laundry} sudah siap diambil 😊 Pesanan {nomor}: {daftar item} · Total
  Rp X ({lunas | sisa Rp Y})." + footer.
- **Promo**: `promo_template` dengan `{nama}` diganti.
- Tanpa nomor HP: tombol WhatsApp menjadi ➕ "Nomor HP belum diisi" yang membuka form pelanggan di kolom HP (seperti
  Woombad).

### 3.10 Peran (ditegakkan database di Mode Online, bagian 2)
| | Pemilik / Admin | Staf |
|---|---|---|
| Pesanan: buat, ubah item/diskon/catatan, ubah status, terima pembayaran | ✔ | ✔ (sampai pesanan Selesai) |
| Pesanan: hapus; ubah setelah Selesai; ubah/hapus pembayaran | ✔ | ✘ |
| Pelanggan: tambah/ubah | ✔ | ✔ |
| Pelanggan: hapus; Impor penyewa | ✔ | ✘ |
| Daftar harga, katalog paket | ✔ | baca saja |
| Jual paket prabayar | ✔ | ✔ |
| Laporan, Riwayat perubahan, Anggota, Data (cadangan) | ✔ | ✘ (menu disembunyikan; data pesanan tetap terbaca) |

### 3.11 Data contoh (Mode Demo)
Organisasi "EG Laundry"; layanan: Cuci kering 6.000/kg (express 10.000; 3/1 hari), Cuci setrika 8.000/kg (express
13.000), Setrika saja 5.000/kg, Bed cover 25.000/pcs, Selimut 20.000/pcs, Sepatu 35.000/pcs; katalog paket "Paket 20 kg
cuci setrika" 140.000 (60 hari). 12 pelanggan (5 anak kos dengan kamar, 7 umum, 2 tanpa HP), ±40 pesanan dalam 2 bulan
terakhir relatif terhadap hari ini dengan campuran status (termasuk 2 terlambat, 3 siap diambil, 4 belum lunas),
pembayaran tunai/transfer/QRIS, 2 paket terjual dengan sebagian terpakai. Nomor HP contoh memakai awalan 0812-0000-xxxx.

### 3.12 Nomor & pembulatan
- `line_total = round(qty × unit_price)` ke rupiah; `qty` kg boleh pecahan (0,5 langkah di UI, 2 desimal diterima).
- `min_qty`: bila qty < min_qty, item dihitung sebagai min_qty (ditampilkan "min. 2 kg").
- Perkiraan selesai dihitung dari hari masuk (hari ke-0) + hari pengerjaan; hari Minggu tidak dilewati (sederhana).
