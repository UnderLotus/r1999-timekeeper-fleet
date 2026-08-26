# Timekeeper Fleet

Timekeeper Fleet models a player's Reverse: 1999 collection and team compositions for planning, sharing, and image export.

## Collection and composition

**Profile**:
A player's owned characters, owned psychubes, and four team compositions.
_Avoid_: Box, save file

**Pool**:
The workspace where catalog entries are viewed and marked as owned.
_Avoid_: Team, profile

**Character build**:
The cultivation state of one owned character: Insight, Level, Resonance, Portray, and active Skin.
_Avoid_: Team build

**Owned psychube**:
A psychube recorded as available with one Amplification value; ownership does not track copy quantity.
_Avoid_: Inventory stack, copy count

**Amplification**:
The official 1–5 progression value of an owned psychube.
_Avoid_: Imprint, quantity

**Team**:
One of exactly four named compositions, each containing four official positions.
_Avoid_: Party preset

**Team slot**:
One of a Team's four official positions, referencing an owned character and the psychube equipment allowed for that character. The fourth slot is not a substitute or bench position.
_Avoid_: Substitute, bench

## Sharing and visibility

**Share URL**:
A link carrying a versioned snapshot of a Profile for another browser to open.
_Avoid_: Cloud save, account sync

**Preview**:
An editable temporary workspace opened from a Share URL while the local Profile remains unchanged.
_Avoid_: Imported profile

**Import**:
The explicit act of replacing the local Profile with the current Preview.
_Avoid_: Open, preview

**Future Sight**:
The receiver-controlled choice to reveal and select Future content. Hiding Future content preserves Profile data and Team references.
_Avoid_: Future-content deletion

## Catalog

**Catalog**:
The known characters, Skins, psychubes, localized names, and release classification available to the planner.
_Avoid_: Profile, Pool

**Future content**:
A Catalog entry not yet released on the tracked Global version.
_Avoid_: Missing content, invalid content
