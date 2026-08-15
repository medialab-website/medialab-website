# Business Replay V1

This provider-neutral harness expresses deterministic synthetic business scenarios, independently authored expected outcomes, observed R71 outcomes, stable mismatch classifications, and a 25-dimension coverage matrix.

Only `SYNTHETIC_FIXTURE` provenance may execute in P02-M16-B. Historical and current-shadow provenance, provider URLs or identifiers, credentials, PII, external paths, network intent, and production targets fail closed before any scenario executor is called.

`PLATFORM_EXECUTED`, `CLASSIFIER_ONLY`, and `DEFERRED_NOT_EXECUTED` are intentionally distinct. Coverage representation never implies Platform execution or historical frequency. The deterministic greedy represented-set plan makes no claim of global mathematical optimality.

Replay artifacts are validation evidence, not canonical business tables. R71 migrations `0001` through `0022` remain the only canonical schema authority.

