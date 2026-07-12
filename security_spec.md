# Firestore Security Specification - MinutesFlow AI

## Data Invariants

1. **User Identity Isolation**: A user can only read and write their own profile document (`/users/{userId}`).
2. **Strict Field Immutability**: Critical user attributes like `id` and administrative parameters (e.g. `accountType` or manually injecting `meetingCredits` on the client) must be protected.
3. **Meeting Isolation**: A meeting document (`/meetings/{meetingId}`) can only be read, updated, or deleted by the user who owns it (`resource.data.userId == request.auth.uid`).
4. **Payment Isolation**: A payment document (`/payments/{paymentId}`) can only be read by the owner who purchased it (`resource.data.userId == request.auth.uid`). No client-side creation or deletion is allowed; payment documents are created strictly via the secure webhook server.
5. **Verified Email Mandate**: To prevent anonymous spoofing, write operations require a verified email address (`request.auth.token.email_verified == true`).

---

## The "Dirty Dozen" Payloads

Here are 12 malicious payloads designed to test security boundaries. All must return `PERMISSION_DENIED`:

### 1. Account Takeover / Spoof Profile
An attacker tries to write to another user's profile document.
* **Path**: `/users/victim_user_123`
* **Operation**: `create` or `update`
* **Payload**: `{ "id": "victim_user_123", "email": "victim@example.com", "meetingCredits": 9999 }`
* **Expected**: `PERMISSION_DENIED`

### 2. Credit Injection (Self-Privilege Escalation)
A user tries to self-grant unlimited meeting credits.
* **Path**: `/users/attacker_user_123`
* **Operation**: `update`
* **Payload**: `{ "meetingCredits": 500 }`
* **Expected**: `PERMISSION_DENIED` (only the server or an admin can modify `meetingCredits`).

### 3. Role Upgrade
A user tries to update their profile's `accountType` to "admin".
* **Path**: `/users/attacker_user_123`
* **Operation**: `update`
* **Payload**: `{ "accountType": "admin" }`
* **Expected**: `PERMISSION_DENIED`

### 4. Shadow Field Injection
An attacker tries to inject undefined shadow fields during profile registration.
* **Path**: `/users/attacker_user_123`
* **Operation**: `create`
* **Payload**: `{ "id": "attacker_user_123", "email": "attacker@example.com", "meetingCredits": 0, "hackerField": "malicious_payload" }`
* **Expected**: `PERMISSION_DENIED`

### 5. Hijack Another User's Meeting
An attacker tries to read another user's meeting minutes.
* **Path**: `/meetings/victim_meeting_abc`
* **Query/Operation**: `get` as `attacker_user_123`
* **Expected**: `PERMISSION_DENIED`

### 6. Create Meeting for Someone Else
An attacker tries to create a meeting owned by another user.
* **Path**: `/meetings/attacker_meeting_xyz`
* **Operation**: `create`
* **Payload**: `{ "id": "attacker_meeting_xyz", "userId": "victim_user_456", "title": "Stolen Meeting", "status": "processed" }`
* **Expected**: `PERMISSION_DENIED`

### 7. Modify Immutable Fields in Meeting
A user tries to change the `userId` or `createdAt` of a meeting after creation.
* **Path**: `/meetings/meeting_abc`
* **Operation**: `update`
* **Payload**: `{ "userId": "different_user_789" }`
* **Expected**: `PERMISSION_DENIED`

### 8. Malicious Massive ID Injection
An attacker attempts to write a meeting with an extremely long, malicious, non-alphanumeric document ID to disrupt system performance or cause storage exhaustion.
* **Path**: `/meetings/super_long_and_extremely_poisonous_junk_characters_!!!!_@@@@_####`
* **Operation**: `create`
* **Expected**: `PERMISSION_DENIED`

### 9. Delete Meeting Owned by Someone Else
An attacker tries to delete a meeting document belonging to a victim.
* **Path**: `/meetings/victim_meeting_123`
* **Operation**: `delete` as `attacker_user_123`
* **Expected**: `PERMISSION_DENIED`

### 10. Fake Client-Side Payment Logging
An attacker tries to insert a fake payment record to force credit additions.
* **Path**: `/payments/fake_stripe_session_999`
* **Operation**: `create`
* **Payload**: `{ "id": "fake_stripe_session_999", "userId": "attacker_user_123", "amount": 2900, "currency": "MYR", "creditsPurchased": 100, "status": "completed" }`
* **Expected**: `PERMISSION_DENIED` (only the backend can write to `/payments`).

### 11. Delete Payment Log
An attacker attempts to delete their transaction history to cover up double-spending or bypass accounting.
* **Path**: `/payments/session_123`
* **Operation**: `delete`
* **Expected**: `PERMISSION_DENIED`

### 12. List Queries Scraping
An attacker tries to read the entire meetings database without filtering by their own `userId`.
* **Path**: `/meetings`
* **Operation**: `list`
* **Expected**: `PERMISSION_DENIED` unless filtered by `resource.data.userId == request.auth.uid`.

---

## The Test Plan

The `firestore.rules` must pass standard validation checks:
- Standard reads on `/users/{userId}` return true if user is owner.
- Writes on `/users/{userId}` are denied if altering `meetingCredits` or `accountType`.
- Creating `/meetings/{meetingId}` requires authenticating, setting `userId` to matching UID, and validating format.
- Operations on `/payments` are only allowed if `request.auth` represents the secure server (or write is blocked completely for client-side SDKs).
