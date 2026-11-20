# Spesifikasi Keselamatan Firestore (`security_spec.md`)

## 1. Data Invariants

1. **Master Gate (`/camp_nights/{campNightId}` -> subkoleksi `slots` & `reports`)**:
   Dokumen `slots/{slotId}` atau `reports/{slotId}` tidak boleh dicipta melainkan dokumen induk `/camp_nights/{campNightId}` wujud (`exists(...)`).
2. **Keintegritian Identiti (`ownerUid`) & Pengesahan E-mel**:
   Semua operasi tulis memerlukan `request.auth != null` dan `request.auth.token.email_verified == true`. Medan `ownerUid` atau `uid` semasa ciptaan mesti sepadan dengan `request.auth.uid` dan tidak boleh diubah selepas ciptaan (`incoming().ownerUid == existing().ownerUid`).
3. **Kunci Keadaan Terminal (`status == 'submitted'`)**:
   Setelah laporan dalam `reports/{slotId}` berstatus `'submitted'`, pengguna biasa tidak boleh menukar atau memadam laporan tersebut kecuali pentadbir/penyelaras (`isAdmin()`).
4. **Pengasingan PII (`users_private/{userId}`)**:
   E-mel dan profil pengguna hanya boleh dibaca oleh pemilik (`request.auth.uid == userId`) atau pentadbir yang disahkan (`isAdmin()`). Pengguna tidak boleh melantik dirinya sendiri sebagai `'coordinator'` atau menulis ke `/admins/{uid}`.
5. **Integriti Masa Pelayan (`request.time`) & Had Saiz**:
   Semua `createdAt` semasa ciptaan dan `updatedAt` semasa ciptaan/kemas kini mesti sama dengan `request.time`. Semua ID laluan disahkan dengan `isValidId()`, semua rentetan mempunyai had `.size()`, dan tatasusunan `memberNames` dihadkan kepada `<= 30` elemen.

## 2. The "Dirty Dozen" Payloads

1. **Unauthenticated Write**: Cipta `/camp_nights/night_1` tanpa `request.auth` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: Pengguna bukan admin dengan `email_verified: false` cuba menulis ke `/camp_nights/night_1` -> `PERMISSION_DENIED`.
3. **Admin Email Spoof (`email_verified: false`)**: Pengguna mengaku `email == 'g-01294773@moe-dl.edu.my'` tetapi `email_verified: false` cuba membaca `/users_private/otherUser` -> `PERMISSION_DENIED`.
4. **Self-Privilege Escalation (Profile Role)**: Pengguna biasa mencipta `/users_private/{uid}` dengan `role: 'coordinator'` -> `PERMISSION_DENIED`.
5. **Self-Admin Injection**: Pengguna biasa cuba menulis ke `/admins/{uid}` -> `PERMISSION_DENIED`.
6. **Cross-Owner Impersonation**: Pengguna A mencipta `/camp_nights/night_2` dengan `ownerUid: 'user_B'` -> `PERMISSION_DENIED`.
7. **Shadow Field ("Ghost Field") Injection**: Pengguna menambah medan haram `isApproved: true` ke dalam payload `SlotReportSnapshot` -> `PERMISSION_DENIED`.
8. **Orphaned Subcollection Write**: Pengguna cuba mencipta `/camp_nights/missing_night/slots/slot_1` tanpa dokumen induk `/camp_nights/missing_night` -> `PERMISSION_DENIED`.
9. **Terminal State Bypass**: Pengguna bukan admin cuba mengubah suai laporan `/camp_nights/night_1/reports/slot_1` yang sudah berstatus `'submitted'` -> `PERMISSION_DENIED`.
10. **Immutable Owner / Timestamp Tampering**: Pengguna mengubah `createdAt` atau `ownerUid` semasa kemas kini, atau menghantar masa klien palsu bagi `updatedAt` -> `PERMISSION_DENIED`.
11. **Oversized String / Path Poisoning**: Pengguna menghantar `title` melebihi 200 aksara atau ID dokumen mengandungi aksara tidak sah / melebihi 128 aksara -> `PERMISSION_DENIED`.
12. **Blanket Query Scraping (`list`)**: Pengguna biasa cuba membuat `list` ke atas `/users_private` atau membaca `/camp_nights/night_1/reports` milik pengguna lain tanpa klausa `ownerUid == request.auth.uid` -> `PERMISSION_DENIED`.
