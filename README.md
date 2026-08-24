# r1999-timekeeper-fleet

A small tool for organizing characters, psychubes, and team configurations in *Reverse: 1999*

**[繁體中文](README_tw.md)**

---

## Simple Usage Guide

### Characters

First, go to the Characters tab. Click a character to mark them as owned

After a character is owned:

- Click the character again to open the full settings and adjust Level, Insight, Resonance, Portray, and more
- You can also click the Insight and Resonance below the portrait to quickly increase them by 1
- The clothing icon can switch Skins
- The × in the upper-right corner removes the owned status

If you are going to record all the characters in your suitcase, it is recommended to use "Set Defaults" first and set the state shared by most of your characters as the default, for example: Insight 3, max level, Resonance 10, Portray 0, Insight Skin

Search also supports all languages

### Psychubes

Likewise, click a psychube to mark it as owned

After a psychube is owned:

- Click it again to increase its Imprint, up to 5
- Use the − in the upper-left corner to lower its Imprint
- Use the × in the upper-right corner to remove the owned status

Because the vast majority of psychubes only have one copy, the function for managing multiple copies of a psychube is omitted here.

### Teams

Click an empty character slot to select a character, and click an empty psychube slot to change the psychube. Teams can be named freely, with a limit of 12 characters

---

## How Share URLs Work

The most important feature update this time

When you enter the site through a share URL, it enters "Preview Mode." If this is a link you saved yourself, you can directly choose to import it and overwrite your data.

But if, for example, you are helping someone else with team-building advice, you can:

- Operate and make changes directly in Preview Mode
- Export the modified result as a link or image in Preview Mode and send it back to the other person
- Select "Back to My Data" to exit cleanly without saving the other person's data

So when you receive someone else's team URL, you can safely open it, look around, and make changes without first worrying that your own configuration will be overwritten

If the shared content contains Future Sight content, you will also be notified and can choose whether to import it

---

## Future Sight

Because each server has different progress, the site displays the overseas server's progress by default. Users who need it can enable Future Sight themselves

---

## Export Images

This image export adds three formats:

- Export teams only
- Export the character pool only
- Teams + character pool

Exports are always based on "the workspace you are currently viewing."
That is, if you are viewing someone else's shared preview, that preview is what will be exported

---


## Development

```bash
npm ci
npm run dev
```

Before committing, run:

```bash
npm test
npm run build
```

To update characters, psychubes, names, release status, and images:

```bash
npm run sync
```

The GitHub Pages base path is `/r1999-timekeeper-fleet/`.

For data sources, the synchronization process, and individual update commands, see [`docs/pipeline.md`](docs/pipeline.md).

---

## Data Sources

Characters, names, release status, and images are mainly compiled from:

- [Reverse-1999-CN-Asset](https://github.com/myssal/Reverse-1999-CN-Asset) — China server character / Skin / psychube structures and original assets
- [re1999-data-global](https://github.com/St-Pavlov-Foundation/re1999-data-global) — Global data, names in each language, and release determination
- [Huiji Wiki](https://res1999.huijiwiki.com) — Character ordering and supplementary data
- [Kornblume](https://github.com/windbow27/kornblume) — Ordering / name fallback
- [wikiru](https://reverse1999.wikiru.jp) and [Reverse: 1999 Fandom Wiki](https://reverse1999.fandom.com) — Supplementary names when upstream data is missing

The copyrights to the game assets belong to **Bluepoch Co., Ltd. (深藍互動)**. This project is an unofficial fan tool.
