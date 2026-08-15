# P02-M16-B Build State

- Controlling authority: P02-M16-B — Historical Business Replay Harness & Coverage Framework R01 plus Scope Amendment R01, Verifier Reconciliation R02, and Verifier Portability Reconciliation R03
- Candidate state: uncommitted, unstaged, bounded synthetic-only nonproduction review candidate
- Base Platform commit: `8f55e159b0d568b149b55d6c515857ec62c657fd`
- Base Platform tree: `aee1823fd990841f57450f850085a395ac316427`
- Observed production/default `main`: `28517e4d2131014cfdf090fa3aa40d6bcf7b6398`; observational only and not used as the build base
- Local branch: `platform-v2-p02-m16-b-historical-business-replay-harness-r01`
- Database boundary: `medialab_p02m16a_test`; restricted runtime `medialab_p02m16a_test_app`; owner only for accepted reset, seed, and synthetic session bootstrap
- Socket/port: `/tmp/mlvs01-p02m16a-pg`, `55447`
- Accepted migrations: exactly `0001` through `0022`; no migration `0023`
- Dependency boundary: byte-identical `package-lock.json`; no dependency changes
- Verifier portability: predecessor packet allowlists removed from the eight authorized domain verifiers; three stale whole-file `package.json` hashes replaced by exact dependency checks; current-catalog role-bearing metadata hashes replaced by exact semantic function/grant verification
- Replay boundary: synthetic-only BusinessReplayScenarioV1, independently authored expected outcomes, observed R71 outcomes, stable mismatch classification, 25-dimension coverage, deterministic greedy represented-set planning, and offline evidence
- Platform execution: baseline Quick Edit, unresolved Needs Review, and append-only reschedule through accepted R71 command/projection surfaces
- Post-R03 validation: TypeScript PASS; focused replay tests 29/29 PASS; full serial regression 439/439 PASS; strict `verify:all` PASS; two clean 29-scenario corpus runs PASS with identical semantic SHA-256 `1bb76357ea085a962bf458a046e79ed5bd62980d82c50ddb8fc0fef3a91aa627`
- Identity-recovery law: START_FRESH records recovery intent for the same Person and Identity while preserving existing history.
- Identity-recovery non-effect: it does not delete memberships, contacts, orders, payments, historical evidence, or profile/preferences data.
- Deferred scope: Actual profile/preferences reset behavior remains deferred until those models exist.
- Prohibited actions: no commit, staging, push, remote branch, PR, Platform/main mutation, deploy, provider/network, real or historical data/media, Desktop, shadow/dual run, cutover, Aryeo action, or later packet
