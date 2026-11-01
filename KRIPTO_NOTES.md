# Catatan Riset Kriptografi: Ukuran Kunci RSA pada Mock SSH Integration Test

## Latar Belakang

CodeQL mendeteksi penggunaan kunci RSA 1024-bit pada `scripts/integration/mock-ssh-test.js`. Kunci tersebut dibuat secara dinamis untuk mock SSH server dalam integration test, bukan untuk sistem produksi. Walaupun konteksnya test-only, penggunaan RSA 1024-bit tetap memunculkan temuan keamanan karena ukuran tersebut berada di bawah rekomendasi minimum modern.

RSA bergantung pada kesulitan faktorisasi bilangan besar. Seiring meningkatnya kapasitas komputasi, ukuran kunci yang dulu dianggap cukup menjadi lebih mudah diserang. Rekomendasi umum saat ini adalah menggunakan RSA minimal 2048-bit untuk kebutuhan kompatibilitas dasar, atau mempertimbangkan algoritma modern seperti Ed25519 untuk SSH jika kompatibilitas sistem mendukung.

## Temuan

- Rule CodeQL: `js/insufficient-key-size`
- CWE: `CWE-326: Inadequate Encryption Strength`
- Lokasi: `scripts/integration/mock-ssh-test.js`
- Kondisi awal: `generateKeyPairSync('rsa', { modulusLength: 1024 })`
- Risiko utama: contoh test dapat menjadi preseden konfigurasi lemah bila disalin ke kode produksi atau dokumentasi operasional.

## Perbaikan Langsung

Perbaikan yang diterapkan:

```js
generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});
```

Alasan memilih RSA 2048-bit:

- Memenuhi rekomendasi minimum CodeQL dan praktik umum.
- Perubahan kecil dan kompatibel dengan library `ssh2` yang sudah digunakan.
- Tidak mengubah tujuan test, yaitu menyediakan host key sementara untuk mock SSH server.

## Rumusan Masalah Riset

1. Seberapa besar dampak ukuran kunci RSA terhadap performa startup mock SSH server dan durasi integration test?
2. Apakah penggunaan algoritma modern seperti Ed25519 lebih tepat untuk test SSH dibanding RSA 2048-bit?
3. Bagaimana cara mencegah konfigurasi kriptografi lemah pada kode test agar tidak menjadi pola yang ditiru pada kode produksi?
4. Bagaimana CodeQL dan static analysis lain membedakan risiko nyata produksi dari risiko preseden pada test fixture?

## Tujuan Riset

- Mengevaluasi tradeoff antara keamanan, kompatibilitas, dan performa pada host key SSH untuk test.
- Membandingkan RSA 2048-bit, RSA 3072-bit, RSA 4096-bit, dan Ed25519 dalam konteks mock SSH server.
- Menyusun panduan internal untuk pemilihan algoritma dan ukuran kunci pada test, development, dan production.
- Mengukur apakah peningkatan ukuran kunci berdampak signifikan pada pipeline CI.

## Pertanyaan Teknis Lanjutan

- Apakah `ssh2` dapat menerima host key Ed25519 yang dibuat secara dinamis oleh Node.js pada versi runtime CI saat ini?
- Apakah format private key `pkcs1` masih paling kompatibel untuk mock server, atau lebih baik memakai format OpenSSH/PKCS8?
- Apakah key generation sebaiknya dilakukan sekali sebagai fixture test, atau tetap ephemeral setiap test run?
- Apakah pipeline perlu rule tambahan untuk menolak RSA di bawah 2048-bit pada seluruh repository?

## Rencana Eksperimen

1. Baseline: jalankan mock integration test dengan RSA 2048-bit dan catat durasi.
2. Bandingkan RSA 3072-bit dan 4096-bit pada test yang sama.
3. Uji Ed25519 jika didukung oleh kombinasi Node.js, OpenSSL, dan `ssh2`.
4. Catat metrik:
   - waktu generate key
   - waktu startup mock server
   - total durasi integration test
   - kompatibilitas di local dan GitHub Actions
5. Dokumentasikan rekomendasi akhir untuk test dan production.

## Catatan Keamanan

- Kunci di mock test bersifat ephemeral dan tidak digunakan untuk production.
- Walaupun demikian, test fixture tetap sebaiknya mengikuti standar minimum agar tidak menormalisasi konfigurasi lemah.
- Untuk production SSH, host key dan user key harus dikelola sebagai secret/key material yang diaudit, bukan dibuat ad hoc di runtime aplikasi biasa.
- Untuk kebutuhan jangka panjang, Ed25519 layak dievaluasi karena ukuran kunci lebih kecil, performa baik, dan umum dipakai di ekosistem SSH modern.

## Referensi Awal

- CodeQL rule: `js/insufficient-key-size`
- CWE-326: Inadequate Encryption Strength
- NIST SP 800-131A: Transitioning the Use of Cryptographic Algorithms and Key Lengths
- Node.js Crypto API: `generateKeyPairSync`
- SSH2 package documentation untuk konfigurasi `hostKeys`
