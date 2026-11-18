#!/usr/bin/env python3
"""Fetch major honours from Wikipedia and Wikidata into scripts/honours.json.

Run occasionally (e.g. after a tournament); build_data.py reads the saved file, so
normal builds don't need the network.

  - World Cup, Euros, Copa América and Africa Cup of Nations winners: the winning
    nation's section of each tournament's "squads" page on English Wikipedia.
  - Champions League finals: the line-ups on each final's Wikipedia page. Only players
    who actually played (starters, and substitutes who came on) are recorded.
  - Ballon d'Or winners: Wikidata ("award received" = Ballon d'Or).

Players are matched to Transfermarkt IDs through Wikidata (property P2446), so there is
no guessing by name.

Usage: python3 scripts/fetch_honours.py
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "scripts", "honours.json")
UA = {"User-Agent": "DeepBenchBuild/1.0 (football quiz data build; https://github.com)"}

# (year, squads page, winning nation's section heading, alternative headings)
WORLD_CUP = [
    (1994, "1994 FIFA World Cup squads", "Brazil"),
    (1998, "1998 FIFA World Cup squads", "France"),
    (2002, "2002 FIFA World Cup squads", "Brazil"),
    (2006, "2006 FIFA World Cup squads", "Italy"),
    (2010, "2010 FIFA World Cup squads", "Spain"),
    (2014, "2014 FIFA World Cup squads", "Germany"),
    (2018, "2018 FIFA World Cup squads", "France"),
    (2022, "2022 FIFA World Cup squads", "Argentina"),
]
EUROS = [
    (1996, "UEFA Euro 1996 squads", "Germany"),
    (2000, "UEFA Euro 2000 squads", "France"),
    (2004, "UEFA Euro 2004 squads", "Greece"),
    (2008, "UEFA Euro 2008 squads", "Spain"),
    (2012, "UEFA Euro 2012 squads", "Spain"),
    (2016, "UEFA Euro 2016 squads", "Portugal"),
    (2020, "UEFA Euro 2020 squads", "Italy"),
    (2024, "UEFA Euro 2024 squads", "Spain"),
]
COPA = [
    (1993, "1993 Copa América squads", "Argentina"),
    (1995, "1995 Copa América squads", "Uruguay"),
    (1997, "1997 Copa América squads", "Brazil"),
    (1999, "1999 Copa América squads", "Brazil"),
    (2001, "2001 Copa América squads", "Colombia"),
    (2004, "2004 Copa América squads", "Brazil"),
    (2007, "2007 Copa América squads", "Brazil"),
    (2011, "2011 Copa América squads", "Uruguay"),
    (2015, "2015 Copa América squads", "Chile"),
    (2016, "Copa América Centenario squads", "Chile"),
    (2019, "2019 Copa América squads", "Brazil"),
    (2021, "2021 Copa América squads", "Argentina"),
    (2024, "2024 Copa América squads", "Argentina"),
]
AFCON = [
    (1994, "1994 African Cup of Nations squads", "Nigeria"),
    (1996, "1996 African Cup of Nations squads", "South Africa"),
    (1998, "1998 African Cup of Nations squads", "Egypt"),
    (2000, "2000 African Cup of Nations squads", "Cameroon"),
    (2002, "2002 African Cup of Nations squads", "Cameroon"),
    (2004, "2004 African Cup of Nations squads", "Tunisia"),
    (2006, "2006 Africa Cup of Nations squads", "Egypt"),
    (2008, "2008 Africa Cup of Nations squads", "Egypt"),
    (2010, "2010 Africa Cup of Nations squads", "Egypt"),
    (2012, "2012 Africa Cup of Nations squads", "Zambia"),
    (2013, "2013 Africa Cup of Nations squads", "Nigeria"),
    (2015, "2015 Africa Cup of Nations squads", "Ivory Coast"),
    (2017, "2017 Africa Cup of Nations squads", "Cameroon"),
    (2019, "2019 Africa Cup of Nations squads", "Algeria"),
    (2021, "2021 Africa Cup of Nations squads", "Senegal"),
    (2023, "2023 Africa Cup of Nations squads", "Ivory Coast"),
]
ALIASES = {"Ivory Coast": ["Ivory Coast", "Côte d'Ivoire", "Cote d'Ivoire"]}

# Champions League finals: year → a word that identifies the winner in the match box.
UCL_WINNERS = {
    1993: "Marseille", 1994: "Milan", 1995: "Ajax", 1996: "Juventus", 1997: "Dortmund",
    1998: "Real Madrid", 1999: "Manchester United", 2000: "Real Madrid", 2001: "Bayern",
    2002: "Real Madrid", 2003: "Milan", 2004: "Porto", 2005: "Liverpool", 2006: "Barcelona",
    2007: "Milan", 2008: "Manchester United", 2009: "Barcelona", 2010: "Inter", 2011: "Barcelona",
    2012: "Chelsea", 2013: "Bayern", 2014: "Real Madrid", 2015: "Barcelona", 2016: "Real Madrid",
    2017: "Real Madrid", 2018: "Real Madrid", 2019: "Liverpool", 2020: "Bayern", 2021: "Chelsea",
    2022: "Real Madrid", 2023: "Manchester City", 2024: "Real Madrid", 2025: "Paris Saint-Germain",
}

BALLON_DOR = "Q166177"


CACHE = os.path.join(ROOT, ".cache", "http")


def get(url: str, params: dict) -> dict:
    """GET JSON, cached on disk so re-runs don't hit Wikimedia again. Waits out rate limits."""
    full = url + "?" + urllib.parse.urlencode(params)
    path = os.path.join(CACHE, hashlib.sha1(full.encode()).hexdigest() + ".json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    for attempt in range(8):
        try:
            with urllib.request.urlopen(urllib.request.Request(full, headers=UA), timeout=60) as r:
                data = json.load(r)
            os.makedirs(CACHE, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f)
            time.sleep(1)  # be polite
            return data
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 7:
                raise
            wait = int(e.headers.get("Retry-After") or 0) or 15 * (attempt + 1)
            print(f"  rate limited, waiting {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def wikitext(title: str) -> str:
    d = get("https://en.wikipedia.org/w/api.php",
            {"action": "parse", "page": title, "prop": "wikitext", "format": "json", "formatversion": 2, "redirects": 1})
    return d["parse"]["wikitext"]


LINK = re.compile(r"\[\[([^\]|#]+)")


HEADING = re.compile(r"^(={2,4})\s*(.*?)\s*\1\s*$", re.M)
NAME = re.compile(r"\|\s*name\s*=\s*(\[\[[^\]]+\]\]|\{\{\s*sortname\s*\|[^}]*\}\})", re.I)


def display(wikitext_heading: str) -> str:
    """Heading text as shown: [[Brazil national football team|Brazil]] -> Brazil."""
    t = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", wikitext_heading)
    return re.sub(r"\[\[([^\]]*)\]\]", r"\1", t).strip()


def article(name_value: str) -> str | None:
    """The article a squad entry links to, from [[Title|Shown]] or {{sortname|First|Last|Target}}."""
    if name_value.startswith("[["):
        return LINK.match(name_value).group(1).strip()
    parts = [p.strip() for p in name_value.strip("{}").split("|")[1:]]
    parts = [p for p in parts if "=" not in p]  # drop named options like nolink=1
    if len(parts) >= 3 and parts[2]:
        return parts[2]
    return f"{parts[0]} {parts[1]}".strip() if len(parts) >= 2 else None


def squad(page: str, team: str) -> list[str]:
    text = wikitext(page)
    wanted = ALIASES.get(team, [team])
    heads = list(HEADING.finditer(text))
    for i, h in enumerate(heads):
        if display(h.group(2)) not in wanted:
            continue
        level = len(h.group(1))
        end = next((n.start() for n in heads[i + 1:] if len(n.group(1)) <= level), len(text))
        titles = [t for t in (article(m.group(1)) for m in NAME.finditer(text[h.end():end])) if t]
        if titles:
            return titles
    raise ValueError(f"no squad for {team} on {page}")


def final_lineups(year: int) -> tuple[list[str], list[str]]:
    """(winners who played, losers who played) for one Champions League final."""
    text = wikitext(f"{year} UEFA Champions League final")
    team1 = re.search(r"\|\s*team1\s*=\s*([^\n]+)", text).group(1)
    team2 = re.search(r"\|\s*team2\s*=\s*([^\n]+)", text).group(1)
    winner = UCL_WINNERS[year]
    if (winner in team1) == (winner in team2):
        raise ValueError(f"{year}: can't tell the winner from {team1!r} / {team2!r}")

    sides: list[list[str]] = []
    current: list[str] = []
    bench = False
    for line in text.splitlines():
        if re.search(r"'''\s*(Manager|Head coach|Coach)", line):
            if current:
                sides.append(current)
            current, bench = [], False
            if len(sides) == 2:
                break
            continue
        if "Substitutes" in line:
            bench = True
            continue
        row = re.match(r"^\|\s*(GK|DF|MF|FW|[A-Z]{2,3})\s*\|\|", line)
        if not row:
            continue
        link = LINK.search(line.split("||", 2)[-1])
        if not link:
            continue
        played = not bench or re.search(r"\{\{\s*sub\s*on", line, re.I)
        if played:
            current.append(link.group(1))
    if len(sides) != 2 or not all(len(s) >= 11 for s in sides):
        raise ValueError(f"{year}: line-ups not found ({[len(s) for s in sides]})")
    return (sides[0], sides[1]) if winner in team1 else (sides[1], sides[0])


def transfermarkt_ids(titles: set[str]) -> dict[str, int]:
    """Wikipedia article title → Transfermarkt player ID, via Wikidata."""
    out: dict[str, int] = {}
    ordered = sorted(titles)
    for k in range(0, len(ordered), 50):
        batch = ordered[k:k + 50]
        d = get("https://www.wikidata.org/w/api.php", {
            "action": "wbgetentities", "sites": "enwiki", "titles": "|".join(batch),
            "props": "claims|sitelinks", "sitefilter": "enwiki", "format": "json", "redirects": "yes",
        })
        # Map back through redirects/normalisation using the returned enwiki sitelink.
        for ent in d.get("entities", {}).values():
            claims = ent.get("claims", {}).get("P2446", [])
            site = ent.get("sitelinks", {}).get("enwiki", {}).get("title")
            if not claims or not site:
                continue
            value = claims[0]["mainsnak"].get("datavalue", {}).get("value")
            if value and str(value).isdigit():
                out[site] = int(value)
    return out


def resolve(titles: set[str]) -> dict[str, str]:
    """Follow redirects so every title maps to its canonical article name."""
    canon: dict[str, str] = {}
    ordered = sorted(titles)
    for k in range(0, len(ordered), 50):
        batch = ordered[k:k + 50]
        d = get("https://en.wikipedia.org/w/api.php",
                {"action": "query", "titles": "|".join(batch), "redirects": 1, "format": "json", "formatversion": 2})
        q = d["query"]
        step = {n["from"]: n["to"] for n in q.get("normalized", [])}
        redir = {r["from"]: r["to"] for r in q.get("redirects", [])}
        for t in batch:
            x = step.get(t, t)
            canon[t] = redir.get(x, x)
    return canon


def ballon_dor() -> list[int]:
    q = f"SELECT DISTINCT ?tm WHERE {{ ?p wdt:P166 wd:{BALLON_DOR} ; wdt:P2446 ?tm . }}"
    d = get("https://query.wikidata.org/sparql", {"query": q, "format": "json"})
    return sorted(int(b["tm"]["value"]) for b in d["results"]["bindings"] if b["tm"]["value"].isdigit())


def main():
    raw: dict[str, list[str]] = {}
    for key, events in [("world_cup", WORLD_CUP), ("euros", EUROS), ("copa_america", COPA), ("afcon", AFCON)]:
        names: list[str] = []
        for year, page, team in events:
            s = squad(page, team)
            print(f"{key:13} {year} {team:13} {len(s)} players")
            names += s
        raw[key] = names
    won, lost = [], []
    for year in sorted(UCL_WINNERS):
        w, l = final_lineups(year)
        print(f"ucl final     {year} {UCL_WINNERS[year]:19} won {len(w)}, lost {len(l)}")
        won += w
        lost += l
    raw["ucl_final_won"], raw["ucl_final_lost"] = won, lost

    titles = {t for names in raw.values() for t in names}
    canon = resolve(titles)
    tm = transfermarkt_ids(set(canon.values()))
    honours: dict[str, list[int]] = {}
    for key, names in raw.items():
        ids = sorted({tm[canon[t]] for t in names if canon.get(t) in tm})
        missing = sorted({t for t in names if canon.get(t) not in tm})
        honours[key] = ids
        print(f"{key}: {len(ids)} players matched, {len(missing)} without a Transfermarkt ID {missing[:5]}")
    honours["ballon_dor"] = ballon_dor()
    print(f"ballon_dor: {len(honours['ballon_dor'])} players")

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "Wikipedia squad and final pages; Wikidata (CC0) for Transfermarkt IDs and the Ballon d'Or",
                   "honours": honours}, f, indent=1)
    print("Wrote", OUT)


if __name__ == "__main__":
    main()
