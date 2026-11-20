import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

/**
 * Verifikasi statik struktur peraturan keselamatan Firestore terhadap spesifikasi "Dirty Dozen"
 * dan syarat Eight Pillars (Master Gate, hasAll/hasOnly, isValidId, request.time, terminal lock, PII isolation).
 */
const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesContent = fs.readFileSync(rulesPath, 'utf8');

const dirtyDozenAssertions = [
  {
    name: '1. Global default-deny catch-all present',
    test: () =>
      /match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/.test(
        rulesContent
      ),
  },
  {
    name: '2. Rules version 2 enforced',
    test: () => /rules_version\s*=\s*'2';/.test(rulesContent),
  },
  {
    name: '3. Email verification required for admin & writes',
    test: () =>
      rulesContent.includes('request.auth.token.email_verified == true') &&
      rulesContent.includes("request.auth.token.email == 'g-01294773@moe-dl.edu.my'"),
  },
  {
    name: '4. Path variable ID poisoning guard (isValidId)',
    test: () =>
      rulesContent.includes('function isValidId(id)') &&
      rulesContent.includes('isValidId(campNightId)') &&
      rulesContent.includes('isValidId(slotId)'),
  },
  {
    name: '5. Master Gate exists() on subcollections',
    test: () =>
      rulesContent.includes(
        'exists(/databases/$(database)/documents/camp_nights/$(campNightId))'
      ),
  },
  {
    name: '6. Strict hasAll + hasOnly key guards in validation helpers',
    test: () =>
      rulesContent.includes('data.keys().hasAll(') &&
      rulesContent.includes('data.keys().hasOnly('),
  },
  {
    name: '7. Strict server timestamps (request.time)',
    test: () =>
      rulesContent.includes('incoming().createdAt == request.time') &&
      rulesContent.includes('incoming().updatedAt == request.time'),
  },
  {
    name: '8. Immutable createdAt and ownerUid on update',
    test: () =>
      rulesContent.includes('incoming().createdAt == existing().createdAt') &&
      rulesContent.includes('incoming().ownerUid == existing().ownerUid'),
  },
  {
    name: '9. Terminal state lock when report status is submitted',
    test: () =>
      rulesContent.includes("existing().status != 'submitted'") &&
      rulesContent.includes('isAdmin()'),
  },
  {
    name: '10. PII isolation & anti self-escalation on users_private and admins',
    test: () =>
      rulesContent.includes('match /users_private/{userId}') &&
      rulesContent.includes("incoming().role == 'teacher'") &&
      rulesContent.includes('match /admins/{uid}') &&
      rulesContent.includes('allow write: if false'),
  },
  {
    name: '11. Bounded memberNames array guard (<= 30)',
    test: () =>
      rulesContent.includes('data.memberNames is list') &&
      rulesContent.includes('data.memberNames.size() <= 30'),
  },
  {
    name: '12. Query enforcement on allow list without blanket signed-in reads',
    test: () =>
      !/allow\s+read:\s*if\s+isSignedIn\(\)\s*;/.test(rulesContent) &&
      rulesContent.includes('resource.data.ownerUid == request.auth.uid'),
  },
];

for (const check of dirtyDozenAssertions) {
  assert.ok(check.test(), `Failed security rule check: ${check.name}`);
}

console.log(
  `Semua ${dirtyDozenAssertions.length} semakan keselamatan Firestore lulus terhadap firestore.rules.`
);
