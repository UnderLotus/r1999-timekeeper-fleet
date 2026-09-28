#!/usr/bin/env python3
"""Fetch and validate Huiji roster HTML using a direct Chrome TLS fingerprint."""

import json
import re
import sys


class UpstreamAcquisitionError(RuntimeError):
    """Expected remote HTTP, challenge, parse, or coverage failure."""


try:
    from curl_cffi import requests
except ImportError:
    print("curl_cffi is required: install requirements-huiji.txt in .venv", file=sys.stderr)
    raise SystemExit(2)

URL = "https://res1999.huijiwiki.com/index.php?title=%E8%A7%92%E8%89%B2%E5%88%97%E8%A1%A8"
IMPERSONATIONS = ("chrome124", "chrome131", "chrome")
CARD = re.compile(
    r'<a href="(/wiki/[^"]+)" title="([^"]*)">\s*<img[^>]*alt="Headicon[^"]*large-(\d+)\.png"',
    re.S,
)
CHALLENGE_MARKERS = (
    "Just a moment",
    "cf-chl-",
    "Checking your browser",
    "Attention Required! | Cloudflare",
)


def fetch_html() -> str:
    failures = []
    for fingerprint in IMPERSONATIONS:
        try:
            response = requests.get(
                URL,
                impersonate=fingerprint,
                timeout=30,
                headers={
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                },
            )
        except Exception as exc:  # transport failures are remote acquisition failures
            failures.append(f"{fingerprint}: {exc}")
            continue
        text = response.text
        if response.status_code != 200:
            failures.append(f"{fingerprint}: HTTP {response.status_code}")
            continue
        if any(marker in text[:8192] for marker in CHALLENGE_MARKERS):
            failures.append(f"{fingerprint}: Cloudflare challenge")
            continue
        cards = CARD.findall(text)
        if len(cards) < 100:
            failures.append(f"{fingerprint}: only {len(cards)} Huiji cards")
            continue
        return text
    raise UpstreamAcquisitionError("Direct Huiji acquisition failed: " + "; ".join(failures))


def main() -> None:
    html = fetch_html()
    entries: dict[int, tuple[int, dict[str, object]]] = {}
    for sequence, (href, name, raw_id) in enumerate(CARD.findall(html)):
        icon_id = int(raw_id)
        entries[icon_id] = (
            sequence,
            {
                "id": icon_id,
                "name": name,
                "href": "https://res1999.huijiwiki.com" + href,
            },
        )
    cards = [card for _, card in sorted(entries.values(), key=lambda item: item[0])]
    if len(cards) < 100:
        raise UpstreamAcquisitionError(
            f"Only {len(cards)} unique Huiji characters after deduplication"
        )
    print(json.dumps(cards, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except UpstreamAcquisitionError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(3)
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
