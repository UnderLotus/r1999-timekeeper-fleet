# CN 4.0 Variant ID update plan

## Goal

Support complete Variant IDs, including `30660001` and `30880001`, without blocking independent catalog updates when one upstream source or one character is unusable.

## Confirmed inputs

- Variant IDs are opaque identifiers. Character ownership comes from the parent entry in `ArcanistMap.live2d`.
- The latest CN Asset mapping adds characters `3155`, `3158`, and `3163` and includes `30660001` under character `3066` and `30880001` under `3088`.
- CN `skin.json` supplies `characterId`; Global skin input remains ID-only.
- Existing runtime selection, Profile sanitation, release overrides, and asset paths already compare complete IDs.
- Share v5 stores only a Variant suffix and changes `30660001` into `306601` after a round trip.

## Decisions

### Variant mapping

Classify each Variant owned by an ArcanistMap character in this order:

1. Recognized initial or insight metadata in `des`.
2. Exact legacy IDs `${baseId}01` and `${baseId}02`.
3. Every other owned ID is a Skin.

Do not infer ownership from ID width or prefixes. Use CN `characterId` only for mapping diagnostics, skipping zero-owner placeholders.

After filtering against CN package Variant IDs, a character candidate is usable only when it has exactly one default and `defaultVariant` references that default.

### Incremental retention

Compose characters independently. When one candidate cannot be constructed or fails default integrity:

- retain the previous complete `SourceCharacter` row when one exists;
- omit an invalid new character for that run;
- continue composing other characters and psychubes.

Retaining the whole row intentionally retains that character's previous names and release state. Other valid characters can still receive current Global names and status.

### Refresh failures

Fallback belongs inside each refresh stage, where upstream failures can be distinguished from local failures.

| Failure | Outcome |
| --- | --- |
| Remote fetch, remote JSON or HTML parse, upstream coverage validation | Warn and use the previously validated input when available |
| No readable prior input required by the dependent build | Fail that dependent operation; keep independently saved caches |
| Local read or write failure, invalid manual configuration, programming or build failure | Fail visibly |
| Character-local structural failure | Retain the previous character row or omit an invalid new row |

Do not add a blanket catch-and-continue wrapper around child processes in `sync-all.ts`.

For Huiji, map card Variant IDs through the current ArcanistMap Variant-to-character relation. Use `/100` only for unmapped legacy six-digit cards. An upstream Huiji failure leaves `release-order.json` unchanged and continues; an unreadable local snapshot or write failure remains fatal.

### Share compatibility

Introduce share v6 with a 27-bit complete Variant ID field. Keep v3-v5 decoders unchanged.

- A structurally invalid payload keeps existing rejection behavior.
- A valid ID not owned by the decoded character clears `activeVariant` and retains the Profile.
- Encoding omits a stale unowned selection.
- Encoding a valid owned Variant outside the wire range fails explicitly.

No new runtime identity registry or security framework is required.

## LOC-172: Variant identity and share v6

Linear: https://linear.app/local-dev-projects/issue/LOC-172/support-complete-variant-ids-and-share-v6

Implement Variant classification, CN-specific ownership typing, final per-character default validation, mapping diagnostics, Huiji ownership mapping, and share v6 compatibility.

Acceptance:

- `30660001` and `30880001` are Skin variants owned by `3066` and `3088`.
- Each emitted character has one default and a matching `defaultVariant`.
- The new Skins remain unreleased while absent from Global data unless manually overridden.
- Mapping diagnostics use CN `characterId`, not sliced IDs.
- Huiji ownership uses exact mapping and preserves the prior snapshot on upstream failure.
- Share v6 round-trips a complete eight-digit Variant ID; a fixed v5 token still decodes unchanged.
- Wrong-owner decoded IDs sanitize to no active Variant without dropping the Profile.

## LOC-173: Nonblocking refresh and CN Asset synchronization

Linear: https://linear.app/local-dev-projects/issue/LOC-173/make-refresh-stages-incremental-and-run-the-cn-asset-sync

Add narrowly classified fallback to Global, CN, name, and Huiji refresh stages; add per-character retained-row composition; then run the complete synchronization pipeline.

Acceptance:

- Upstream refresh failures use a validated prior input and allow independent updates to continue.
- Local corruption, writes, manual policy errors, and build failures remain visible failures.
- One invalid existing character retains its previous complete row; one invalid new character is omitted; unaffected records update.
- A single `npm run sync` completes against the current upstream data after Ticket A.
- The resulting report lists character, Variant, image, localization, release-status, warning, and release-order changes.
- Full tests, production build, and `git diff --check` pass.
- Existing browser verifies Future Sight selection, sharing, and reload of an eight-digit Skin.

Ticket B is blocked by Ticket A.

## Durable tests

Keep only contract-level regressions:

- the two current eight-digit Variant examples;
- per-character retained-row behavior;
- upstream failure with a validated prior input;
- Huiji snapshot retention;
- one v6 complete-ID round trip;
- one fixed historical v5 token;
- wrong-owner sanitation.

Do not add update-specific snapshots, generic adversarial suites, transaction machinery, or unrelated safety boundaries.
