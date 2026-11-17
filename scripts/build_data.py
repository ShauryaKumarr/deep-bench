#!/usr/bin/env python3
"""Build Deep Bench game data.

Clones (or reuses) the two source repositories into .cache/, computes a fame
score per player, generates prompts and writes:

  public/data/players.json          every player, ordered by fame (most famous first)
  public/data/days/YYYY-MM-DD.json  7 prompts per day for DAYS days

Usage: python3 scripts/build_data.py [--start YYYY-MM-DD] [--days 1460]
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import math
import os
import random
import re
import subprocess
from collections import defaultdict
from itertools import combinations

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
OUT = os.path.join(ROOT, "public", "data")

TM_REPO = "https://github.com/eordo/transfermarkt-data.git"
FD_REPO = "https://github.com/salimt/football-datasets.git"
FD_DIR = "datalake/transfermarkt"

PROMPTS_PER_DAY = 7
NO_REPEAT_DAYS = 150
TOP_CLUBS = 60
MIN_ANSWERS, MAX_ANSWERS = 6, 250
MIN_WELL_KNOWN = 2
WELL_KNOWN_TOP_N = 1500  # the 1,500 most famous players count as "well known"
SEED = 1992

# ---------------------------------------------------------------------------
# Display names

LEAGUES = {
    "Premier League": ("Premier League", "the Premier League"),
    "Laliga": ("La Liga", "La Liga"),
    "Serie A": ("Serie A", "Serie A"),
    "Bundesliga": ("Bundesliga", "the Bundesliga"),
    "Ligue 1": ("Ligue 1", "Ligue 1"),
    "Eredivisie": ("Eredivisie", "the Eredivisie"),
    "Super Lig": ("Süper Lig", "the Süper Lig"),
    "Saudi Pro League": ("Saudi Pro League", "the Saudi Pro League"),
}

NATIONS = {
    "Korea, South": "South Korea",
    "Korea, North": "North Korea",
    "Turkey": "Türkiye",
    "Cote d'Ivoire": "Ivory Coast",
    "Bosnia-Herzegovina": "Bosnia and Herzegovina",
    "Curacao": "Curaçao",
    "St. Kitts & Nevis": "St Kitts and Nevis",
    "St. Lucia": "St Lucia",
    "St. Vincent & Grenadinen": "St Vincent and the Grenadines",
    "Trinidad and Tobago": "Trinidad and Tobago",
    "Chinese Taipei": "Taiwan",
    "Southern Sudan": "South Sudan",
    "The Gambia": "Gambia",
    "Hongkong": "Hong Kong",
    "Jugoslawien (SFR)": "Yugoslavia",
    "Neukaledonien": "New Caledonia",
}

# Countries that read better with a leading "the" ("from the Netherlands").
NATIONS_WITH_THE = {
    "Netherlands", "United States", "Czech Republic", "Dominican Republic",
    "Central African Republic", "DR Congo", "Philippines", "Gambia",
    "Comoros", "Faroe Islands", "Netherlands Antilles", "United Arab Emirates",
    "Cayman Islands", "Bahamas", "Maldives", "Republic of the Congo",
}

CLUBS = {
    "FC Barcelona": "Barcelona",
    "Paris Saint-Germain": "PSG",
    "Atlético de Madrid": "Atlético Madrid",
    "Bayer 04 Leverkusen": "Bayer Leverkusen",
    "Ajax Amsterdam": "Ajax",
    "Feyenoord Rotterdam": "Feyenoord",
    "Real Betis Balompié": "Real Betis",
    "Olympique Marseille": "Marseille",
    "Olympique Lyon": "Lyon",
    "Stade Rennais FC": "Rennes",
    "LOSC Lille": "Lille",
    "OGC Nice": "Nice",
    "Bologna FC 1909": "Bologna",
    "US Sassuolo": "Sassuolo",
    "TSG 1899 Hoffenheim": "Hoffenheim",
    "FC Schalke 04": "Schalke 04",
    "SV Werder Bremen": "Werder Bremen",
    "1.FSV Mainz 05": "Mainz 05",
    "RCD Espanyol Barcelona": "Espanyol",
    "FC Girondins Bordeaux": "Bordeaux",
    "AS Saint-Étienne": "Saint-Étienne",
    "Fenerbahce": "Fenerbahçe",
    "Besiktas JK": "Beşiktaş",
    "Galatasaray": "Galatasaray",
    "UC Sampdoria": "Sampdoria",
    "Udinese Calcio": "Udinese",
    "Cagliari Calcio": "Cagliari",
    "Brighton & Hove Albion": "Brighton",
    "Wolverhampton Wanderers": "Wolves",
    "Tottenham Hotspur": "Tottenham",
    "Celta de Vigo": "Celta Vigo",
    "Deportivo de La Coruña": "Deportivo La Coruña",
    "RC Lens": "Lens",
    "RC Strasbourg Alsace": "Strasbourg",
    "Hellas Verona": "Hellas Verona",
    "Borussia Mönchengladbach": "Gladbach",
    "Al-Hilal SFC": "Al-Hilal",
    "Al-Nassr FC": "Al-Nassr",
    "Al-Ittihad Club": "Al-Ittihad",
    "Hertha BSC": "Hertha Berlin",
    "VfL Wolfsburg": "Wolfsburg",
    "VfB Stuttgart": "Stuttgart",
    "Torino FC": "Torino",
    "Hamburger SV": "Hamburg",
}

# Prefix/suffix tokens stripped by default ("Chelsea FC" -> "Chelsea").
CLUB_AFFIXES = {
    "FC", "AFC", "CF", "SC", "AC", "AS", "SS", "SSC", "ACF", "BC", "CFC", "JK",
    "SFC", "US", "SV", "VfL", "VfB", "TSG", "SL", "RC", "CD", "UD", "SD", "RCD",
    "Calcio", "1909", "1913", "1907", "1899", "04", "05",
}
KEEP_CLUBS = {"AC Milan", "AS Roma", "AS Monaco", "Inter Milan", "SC Freiburg"}


def club_name(raw: str) -> str:
    if raw in CLUBS:
        return CLUBS[raw]
    if raw in KEEP_CLUBS:
        return raw.replace("AS Roma", "Roma")
    words = raw.split()
    while len(words) > 1 and words[0] in CLUB_AFFIXES:
        words.pop(0)
    while len(words) > 1 and words[-1] in CLUB_AFFIXES:
        words.pop()
    return " ".join(words)


def nation_name(raw: str) -> str:
    return NATIONS.get(raw, raw)


def nation_phrase(name: str) -> str:
    return f"the {name}" if name in NATIONS_WITH_THE else name


POSITION_GROUP = {
    "Goalkeeper": 0,
    "Centre-Back": 1, "Left-Back": 1, "Right-Back": 1, "Defender": 1, "Sweeper": 1,
    "Defensive Midfield": 2, "Central Midfield": 2, "Attacking Midfield": 2,
    "Left Midfield": 2, "Right Midfield": 2, "Midfielder": 2,
    "Right Winger": 3, "Left Winger": 3, "Centre-Forward": 3,
    "Second Striker": 3, "Striker": 3,
}
POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Forward"]
POSITION_PHRASE = ["A goalkeeper", "A defender", "A midfielder", "A forward"]

# ---------------------------------------------------------------------------
# Sources


def ensure_repo(url: str, name: str) -> str:
    path = os.path.join(CACHE, name)
    if not os.path.isdir(path):
        os.makedirs(CACHE, exist_ok=True)
        env = dict(os.environ, GIT_LFS_SKIP_SMUDGE="1")  # skip the LFS files
        subprocess.run(["git", "clone", "--depth", "1", "-q", url, path], check=True, env=env)
    return path


def inflate(value: float, year: int) -> float:
    """Bring pre-2019 money in line with the modern market."""
    return value * 2 ** ((2019 - year) / 5.5) if year < 2019 else value


def log_scale(v: float, lo: float, hi: float) -> float:
    if v <= lo:
        return 0.0
    return min(1.0, (math.log10(v) - math.log10(lo)) / (math.log10(hi) - math.log10(lo)))


# ---------------------------------------------------------------------------


def load(tm_dir: str, fd_dir: str):
    frames = [pd.read_csv(f) for f in sorted(glob.glob(os.path.join(tm_dir, "*", "*.csv")))]
    tr = pd.concat(frames, ignore_index=True)
    tr = tr.dropna(subset=["player_id", "player_name", "club"])
    tr["player_id"] = tr["player_id"].astype(int)
    # One name per club: "Parma FC", "AC Parma" and "Parma Calcio 1913" are all Parma.
    tr["club"] = tr["club"].map(club_name)
    tr = tr.sort_values(["season", "window"], kind="stable")

    mv = pd.read_csv(os.path.join(fd_dir, "player_market_value", "player_market_value.csv"))
    mv = mv.dropna()
    mv["year"] = mv["date_unix"].str.slice(0, 4).astype(int)

    nat = pd.read_csv(os.path.join(fd_dir, "player_national_performances", "player_national_performances.csv"))
    return tr, mv, nat


def compute_players(tr: pd.DataFrame, mv: pd.DataFrame, nat: pd.DataFrame) -> pd.DataFrame:
    last = tr.groupby("player_id").tail(1).set_index("player_id")
    players = pd.DataFrame(index=last.index)
    players["name"] = last["player_name"].str.strip()
    players["nation"] = last["nationality"].fillna("").map(lambda s: nation_name(s) if s else "")
    players["pos"] = last["position"].map(POSITION_GROUP).fillna(2).astype(int)
    span = tr.groupby("player_id")["season"].agg(["min", "max"])
    players["first"] = span["min"]
    players["last"] = span["max"]

    # Peak value: max of market values and fees, inflated for pre-2019 years.
    vals = [
        pd.DataFrame({"player_id": mv["player_id"], "v": [inflate(v, y) for v, y in zip(mv["value"], mv["year"])]}),
        pd.DataFrame({"player_id": tr["player_id"], "v": [inflate(v, y) for v, y in zip(tr["market_value"].fillna(0), tr["season"])]}),
        pd.DataFrame({"player_id": tr["player_id"], "v": [inflate(v, y) for v, y in zip(tr["fee"].fillna(0), tr["season"])]}),
    ]
    peak = pd.concat(vals).groupby("player_id")["v"].max()
    players["peak"] = peak.reindex(players.index).fillna(0)

    # Senior caps. The source has youth sides too, with no team names, so the
    # senior team for each nationality is the side its players were capped for
    # most often in total. A player's caps = their most-capped senior side.
    nat = nat[nat["player_id"].isin(players.index)]
    nat = nat.merge(players[["nation"]], left_on="player_id", right_index=True)
    totals = nat.groupby(["nation", "team_id"])["matches"].sum().reset_index()
    senior = set(totals.sort_values("matches").groupby("nation").tail(1)["team_id"])
    caps = nat[nat["team_id"].isin(senior)].groupby("player_id")["matches"].max()
    players["caps"] = caps.reindex(players.index).fillna(0).astype(int)

    # Log scale from 50k (a squad player) to the biggest value in the data.
    hi = players["peak"].max()
    players["fame"] = 0.55 * players["peak"].map(lambda v: log_scale(v, 5e4, hi)) + 0.45 * players["caps"].clip(upper=120) / 120
    players = players.sort_values(["fame", "peak"], ascending=False)
    players["idx"] = range(len(players))
    return players


def build_prompts(tr: pd.DataFrame, players: pd.DataFrame):
    idx = players["idx"].to_dict()
    well_known = set(range(WELL_KNOWN_TOP_N))

    by_club: dict[str, set[int]] = defaultdict(set)
    by_league: dict[str, set[int]] = defaultdict(set)
    for pid, club, league in zip(tr["player_id"], tr["club"], tr["league"]):
        by_club[club].add(idx[pid])
        by_league[league].add(idx[pid])
    by_nation: dict[str, set[int]] = defaultdict(set)
    by_pos: dict[int, set[int]] = defaultdict(set)
    for i, nation, pos in zip(players["idx"], players["nation"], players["pos"]):
        if nation:
            by_nation[nation].add(i)
        by_pos[pos].add(i)

    # The most famous clubs: the summed fame of each club's 40 best-known players.
    fame = players.set_index("idx")["fame"].to_dict()
    club_fame = {c: sum(sorted((fame[i] for i in s), reverse=True)[:40]) for c, s in by_club.items()}
    top = sorted(club_fame, key=club_fame.get, reverse=True)[:TOP_CLUBS]
    print("Top clubs:", ", ".join(top))

    prompts = []

    def add(kind: str, key: str, text: str, answers: set[int], clubs=()):
        n_known = len(answers & well_known)
        if MIN_ANSWERS <= len(answers) <= MAX_ANSWERS and n_known >= MIN_WELL_KNOWN:
            prompts.append({"kind": kind, "key": key, "text": text, "answers": sorted(answers),
                            "known": n_known, "clubs": set(clubs)})

    for a, b in combinations(top, 2):
        x, y = sorted([a, b])
        add("pair", f"pair:{a}|{b}", f"Played for {x} and {y}", by_club[a] & by_club[b], (a, b))
    for c in top:
        for n, s in by_nation.items():
            add("nation", f"nation:{c}|{n}", f"Played for {c}, from {nation_phrase(n)}", by_club[c] & s, (c,))
        for p, s in by_pos.items():
            add("pos", f"pos:{c}|{p}", f"{POSITION_PHRASE[p]} who played for {c}", by_club[c] & s, (c,))
    for lg, s in by_league.items():
        for n, ns in by_nation.items():
            add("league", f"league:{lg}|{n}", f"A player from {nation_phrase(n)} who played in {LEAGUES[lg][1]}", s & ns)

    counts = defaultdict(int)
    for p in prompts:
        counts[p["kind"]] += 1
    print("Prompt pool:", dict(counts))
    return prompts


DAY_PLAN = ["pair", "nation", "pos", "league", "pair", "nation", "any"]


def schedule(prompts, start: dt.date, days: int):
    rng = random.Random(SEED)
    pools = defaultdict(list)
    for p in prompts:
        pools[p["kind"]].append(p)
    last_used: dict[str, int] = {}
    out = []
    for d in range(days):
        chosen, clubs = [], set()

        def ok(p):
            return (d - last_used.get(p["key"], -10**9) >= NO_REPEAT_DAYS
                    and p not in chosen and not (p["clubs"] & clubs))

        for kind in DAY_PLAN:
            kinds = [kind] if kind != "any" else list(pools)
            cands = [p for k in kinds for p in pools[k] if ok(p)]
            if not cands:  # fall back to any type rather than repeat
                cands = [p for p in prompts if ok(p)]
            # Lean towards prompts with plenty of well-known answers, and away
            # from ones that have been used before.
            weights = [math.sqrt(p["known"]) * (0.5 if p["key"] in last_used else 1.0) for p in cands]
            p = rng.choices(cands, weights=weights)[0]
            chosen.append(p)
            clubs |= p["clubs"]
            last_used[p["key"]] = d
        # Easiest first: most well-known answers relative to total.
        chosen.sort(key=lambda p: -p["known"] / len(p["answers"]))
        out.append((start + dt.timedelta(days=d), chosen))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2026-11-17")
    ap.add_argument("--days", type=int, default=1460)
    args = ap.parse_args()

    tm = ensure_repo(TM_REPO, "transfermarkt-data")
    fd = os.path.join(ensure_repo(FD_REPO, "football-datasets"), FD_DIR)
    tr, mv, nat = load(tm, fd)
    players = compute_players(tr, mv, nat)
    print(f"{len(players)} players. Most famous:", ", ".join(players["name"].head(15)))

    prompts = build_prompts(tr, players)
    days = schedule(prompts, dt.date.fromisoformat(args.start), args.days)

    nations = sorted({n for n in players["nation"] if n})
    nat_idx = {n: i for i, n in enumerate(nations)}
    os.makedirs(os.path.join(OUT, "days"), exist_ok=True)
    for f in glob.glob(os.path.join(OUT, "days", "*.json")):
        os.remove(f)

    payload = {
        "nations": nations,
        "positions": POSITIONS,
        # [name, nation index (-1 unknown), position group, first season, last season]
        "players": [[r.name, nat_idx.get(r.nation, -1), int(r.pos), int(r.first), int(r.last)]
                    for r in players.itertuples()],
    }
    with open(os.path.join(OUT, "players.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    index = []
    for date, chosen in days:
        day = {"date": date.isoformat(),
               # answers are player indices, most famous first
               "prompts": [{"text": p["text"], "answers": p["answers"]} for p in chosen]}
        with open(os.path.join(OUT, "days", f"{date.isoformat()}.json"), "w", encoding="utf-8") as f:
            json.dump(day, f, ensure_ascii=False, separators=(",", ":"))
        index.append(date.isoformat())
    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump({"first": index[0], "last": index[-1]}, f)
    print(f"Wrote {len(days)} days from {index[0]} to {index[-1]}.")


if __name__ == "__main__":
    main()
