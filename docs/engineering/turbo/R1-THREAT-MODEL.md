# R1 Trust Boundaries & Isolation Threat Model

**Baseline:** `74b26fc78ebd14a784981ba8e83bebf878c20865` (v1.2.4; Memory v2.1.7)  
**Owner:** A1 Security Agent · **Independent review:** A5 + LEAD · **Status:** DRAFT; reproduction and peer validation remain open.

## 1. Security goals
Protect independent tenant data when **restricted/scoped principals** are used, while deliberately retaining the original **local single-user shared-memory** behavior unless the product requirement explicitly changes. Do not equate an unauthenticated loopback API with an internet-exposed server without confirming the bind address. Never assume user/project/profile IDs alone are strong tenant boundaries without an explicit policy.

## 2. Entry points
- Native agent Hooks/Plugins → Memory HTTP Server `127.0.0.1:18960`.
- Local CLI/desktop Memory and Gateway through localhost.
- Scoped/cloud token HTTP clients (`Memory/src/server/http.ts`): principal has scopes, namespace and authenticatedNamespace. Local/anonymous scopes differ.
- Native history ingestion `AgentSourceCore` and background workers.
- Viewer/SSE, temporary logs and optional analytics export.

## 3. Observed facts
1. `Memory/src/server/index.ts` passes `{ allowAnonymous: true }` when `config.storage.token` is absent. Check runtime bind host and network exposure before treating this as remote access.
2. `Memory/src/server/http.ts` supports scoped keys internally, but normal server entrypoint only wires local token or anonymous mode.
3. `Memory/src/server/http.ts` generic `assertNamespaceScope` is currently no-op. `mergeNamespaces` merges principal and request; `strictEnvelopeWithPrincipal` has explicit conflict tests for protocol V2.
4. `Memory/src/service/memory-service.ts` `assertSessionInScope`, `assertEpisodeInScope` and `assertRawTurnInScope` are no-ops; `assertMemoryInScope` checks tenant mismatch for external evidence only.
5. Existing test `Memory/tests/contract/memory-rest-service.test.ts` explicitly expects `reader-b` to retrieve `writer-a` generic Memory. **This is established baseline behavior**, not an accidental test omission. A blanket userId restriction would break feature compatibility.
6. `SessionRecord`, `EpisodeRecord`, `RawTurnRecord` have user/project/source fields; these do not all carry durable tenant identity. A strict tenant solution will need a compatible persisted ownership model, not merely an HTTP header filter.
7. Public `/api/v1/memory/search` constructs a new request and does not forward `recordEvent`, while retrieval honors `recordEvent:false`. This needs side-effect evidence and an explicit API contract.
8. R1 Baseline GitHub Actions existing contract/lifecycle/smoke passed at `7e6434dd`; specific isolation negative tests **not yet security-passing**.

## 4. Proposed access policy (NOT implemented)
| Principal | Expected data access | Evidence/tests |
|---|---|---|
| Local owner token (legacy) | Shared memory across local agents/profiles, subject to existing behavior | Original happy-path cases and no changes |
| Anonymous localhost (legacy opt-in config) | Existing behavior on loopback only, never assumed safe off-loopback | socket bind tests |
| Scoped key for tenant A | Only owned A memories, episodes and raw turns | negative A→B tests |
| Scoped key `memory:read` | Read only, never mutates history/trace/audits unless explicit logging policy | write denial + `recordEvent` |
| Scoped key `memory:write` | Write only allowed resources | namespace claims tests |
| Cloud identity | Tenant-scoped and not overrideable by request headers/body | authenticated vs requested namespace tests |
| Background worker | Run tasks with recorded, validated owner scope | index/evolution separation tests |

## 5. Attack paths and negative test inventory
- **SEC-01 / IDOR:** scoped A/B keys; A creates, B attempts GET, DELETE, task DELETE and raw-turn redaction. Assert deny, no DB changes and consistent status codes. Existing generic `reader-b` behavior must be changed **only with explicit scoped/tenant policy**.
- **SEC-02:** authenticated principal supplies conflicting namespace body/header/source. Verify principal cannot be weakened by request.
- **SEC-03:** leak through `panel/items`, `viewer`, `SSE`, `search`, `recall evidence`, backup/bundle and logs.
- **SEC-04:** `recordEvent:false` search must not create a recall event or write log, if contract requires this.
- **SEC-05:** token in URL query may leak into reverse-proxy logs/referrers; check viewer/SSE restrictions and log redaction.
- **SEC-06:** reindex/outbox and background jobs must not create cross-tenant search hits.
- **SEC-07:** source text, recalled content and skill documents are untrusted inputs: prompt-injection attempts must not bypass supervisor/security rules.

## 6. Required R2 design decisions before remediation
1. Agree identity model (local owner, user, tenant, project, source, profile) and whether cross-agent global sharing should use a stable owner namespace or explicit sharing grants.
2. Persist tenant ownership safely. Provide migration/backfill semantics with deterministic, verifiable rollback for pre-tenant data.
3. Enforce access at both repository query and service mutation layer, not UI-only.
4. Separate trusted local-token compatibility path from restricted scoped principals; test both.
5. Deny before opening destructive transactions or recording sensitive events.
6. Add HTTP and direct-service tests, negative side-effect assertions, and CI release gates; convert R1 XFAIL canaries into standard passing tests.

## 7. Acceptance & evidence
- R1 known-failure tests: `Memory/tests/contract/turbo-r1-known-isolation-gaps.test.ts` (PR #17) mark expected failures. They **do not certify security**.
- Hard gate: no production security claim or R2 merge until zero cross-tenant successes for scoped credentials on actual packaged server, negative path logs available and QA independently reproduces.
- UI/UX and existing local single-user feature parity must remain unchanged.
