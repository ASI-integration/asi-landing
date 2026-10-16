# Optional purpose constraint: local rollback rehearsal

PASS on the isolated restored container. The six frozen migrations plus the separately selected optional repair ran in one transaction, followed by unconditional ROLLBACK. No source access or committed changes occurred. The default six-migration candidate remains unchanged.

The restored CHECK accepts 29 literals. Independent source comparison found the canonical application list and repair both contain the same 42 literals, with 13 additions and no removals. The exact repair was applied temporarily. Its actual validated CHECK definition was retrieved from pg_constraint and applied unchanged to a temporary purpose-only table. All 42 canonical values were actually inserted; an unknown value was rejected with SQLSTATE23514 and the expected constraint name.

This proves bounded predicate acceptance, not a complete communication-intent INSERT/application workflow. It deliberately avoids unrelated foreign keys and defaults. After rollback, full schema/history fingerprints, all 182 COPY table headers and 873 row values, and all four sequence states matched their pre-run fingerprints.

Receipt: PURPOSE-REHEARSAL-38942690625.json. The receipt's purpose_constraint field describes the preflight restored 29-value constraint, not the temporary repaired state. The success marker and exact predicate fixture prove the repaired 42-value behavior within the rolled-back transaction.

Repair SHA256: 9e2c2516d07041fa29feab60abb010443d66bf7c0337bb89ab73c191e0d69f7f.
Predicate fixture SHA256: b67e464cdd6003127534fe3e20e770d3a7215b38bdd69c24d982f04c794115e5.
Executed combined rehearsal SHA256: 88a7b1cbd903311dbbe45fc5fe01fb59d92afa48e14e12a5d5bbbb80a6e7c83e.
