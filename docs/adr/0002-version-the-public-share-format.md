# Version the public share format

Share URLs are a public compatibility boundary with no backend migration path. Any incompatible payload change increments the format version, and decoders for previously published versions remain while those links are supported. This accepts decoder maintenance so saved or shared URLs do not silently break as the compact encoding evolves.

Variant IDs are opaque, so payloads store complete IDs rather than reconstructing them from a Character ID and a suffix. A decoded Variant not owned by its Character clears only that selection and retains the rest of the Profile. Owned IDs outside the format’s numeric range fail encoding instead of being truncated.
