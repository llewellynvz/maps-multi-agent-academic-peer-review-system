# Security and data protection

This document describes MAPS's security model: what it protects, the threats it is designed against, and the controls that enforce each guarantee. It is maintained alongside the code, and the controls listed here are exercised by the automated test suite.

## 1. Assets and guarantees

| Asset | Guarantee |
|---|---|
| Manuscript text and author identities | Never leave the host. Never appear in an outbound query, a log line, or an event payload. |
| Reviewer findings and editorial synthesis | Stored locally. Editor-only material never reaches the author-facing letter or its evidence map. |
| Past review letters (voice exemplars) | Stay on the host; only writing style is derived from them. Never baked into container images. |
| Provider credentials | Encrypted at rest; never logged; environment configuration always takes precedence. |
| Evidence ledger and event trail | Append-only; corrections supersede and never overwrite. |

## 2. Threat model

| Threat | Control |
|---|---|
| **Prompt injection embedded in a manuscript** (hidden text, metadata, white-on-white instructions) | Layered screening before any agent sees the text: deterministic patterns plus a model-assisted detector. Instructional content (Tier 2) is quarantined and replaced with neutral markers, the review continues, and the editor receives an editor-only `REV-SAN` signal that names what was found and where without repeating it. Data-misrepresenting tampering (Tier 3) halts the run. A constitution frame instructs every agent never to follow manuscript-embedded instructions. |
| **Confidential text leaking through literature search** | Only three allowlisted scholarly hosts are reachable. Queries are HMAC-signed and verified with constant-time comparison, carry construct and method terms only, and are blocked when any eight-word window overlaps protected manuscript text. |
| **Editor-only content reaching authors** | The release gate checks every author-facing artefact for editor-only finding identifiers and confidential headings, and redaction runs on whole identifier tokens. |
| **Fabricated or unverifiable citations in the review** | Named works must be traceable to the field dossier or the manuscript's own reference list; the deterministic gate and the final critic both check. |
| **Cross-site request forgery** | State-changing API requests that a browser marks cross-site are refused (`Sec-Fetch-Site`, with an `Origin`/`Host` fallback). Session cookies are HTTP-only and `SameSite=Strict`. |
| **Open redirect after sign-in** | The post-login destination is resolved as a URL and must be on the application's own origin. |
| **Passphrase guessing** | scrypt-hashed passphrase, per-client and global failure throttling, and a slow global drip past the limit so an attacker cannot lock the owner out. |
| **Oversized or malformed requests** | Schema validation on every JSON body (422 on mismatch); uploads refused on declared length before buffering; per-type size caps; a DOCX size limit enforced before conversion. |
| **Credential disclosure** | AES-256-GCM envelope encryption under an operator-held master key; secret-shaped values and secret-named fields redacted from logs. |
| **Network exposure** | Docker publishes the application on `127.0.0.1` by default; GROBID is loopback-only and reached over the internal compose network. |
| **Container compromise** | The container drops to an unprivileged user with `no-new-privs` after taking ownership of its data volume. |
| **Supply-chain risk** | Frozen lockfile installs, a high-severity dependency audit, and a full-history secret scan in continuous integration. |

## 3. Access control

MAPS is a single-operator system. When an instance passphrase is set in **Settings**, every API route except the health check and the sign-in endpoint requires a valid session. When no passphrase is set, the instance is open to anyone who can reach it. That is safe only on the loopback interface, which is the default binding. Set a passphrase before widening `MAPS_BIND`.

## 4. Data lifecycle

- **Storage.** All state lives under `data/`: the SQLite databases, per-review blobs and artefacts, and the citation cache.
- **Deletion.** A single review is purged, database rows and files alike, from its library card or from **Settings**. A running review must be cancelled and stopped before it can be deleted. **Delete all** requires a typed confirmation and refuses while any review is queued or running. Cached citation lookups are retained.
- **Retention.** Failed and halted reviews keep their artefacts until deleted, so they can be inspected and retried.
- **Logs.** Rotating structured logs redact credentials and secret-shaped values, and carry no manuscript text.

## 5. Operator responsibilities

1. Keep `MAPS_MASTER_KEY` and `.env` out of version control and backups that leave the host.
2. Set an instance passphrase before exposing the application beyond the loopback interface, and place it behind TLS.
3. Restrict access to `data/` and to backups; they contain manuscripts and reviews.
4. Keep voice exemplars in `knowledge/exemplars/`, which is excluded from the repository and from image builds.
5. Apply dependency updates promptly when the audit reports an advisory.

## 6. Responsible disclosure

Report suspected vulnerabilities privately to **hello@psynalytics.com** with the subject line "MAPS security". Do not open a public issue, and do not test against any deployment you do not own.
