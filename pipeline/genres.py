from __future__ import annotations

import re
from pathlib import Path

import yaml

from .common import ROOT


def load_genre_keywords(path: Path | None = None) -> dict[str, list[str]]:
    file_path = path or ROOT / "config" / "genres.yaml"
    with file_path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return {str(k): list(v) for k, v in data.items()}


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9_]+", (text or "").lower())


def _normalize_piece(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _raw_genre_candidates(raw_genre: str | None) -> list[str]:
    if not raw_genre:
        return []
    return [_normalize_piece(x) for x in str(raw_genre).split("|") if _normalize_piece(x)]


def _build_raw_alias_map() -> dict[str, str]:
    # Map common source-genre labels to our canonical set.
    return {
        "fantasy": "fantasy",
        "epic fantasy": "fantasy",
        "urban fantasy": "fantasy",
        "dark fantasy": "fantasy",
        "science fiction": "science_fiction",
        "sci fi": "science_fiction",
        "scifi": "science_fiction",
        "dystopia": "science_fiction",
        "mystery": "mystery",
        "thriller": "mystery",
        "crime": "mystery",
        "detective": "mystery",
        "romance": "romance",
        "historical romance": "romance",
        "history": "history",
        "historical": "history",
        "historical fiction": "history",
        "world war ii": "history",
        "war": "history",
        "self help": "self_help",
        "self-help": "self_help",
        "psychology": "self_help",
        "personal development": "self_help",
    }


def _choose_genre_from_raw_list(raw_genre: str | None, genre_keywords: dict[str, list[str]]) -> str | None:
    raw_parts = _raw_genre_candidates(raw_genre)
    if not raw_parts:
        return None

    # 1) exact canonical match
    for part in raw_parts:
        canonical = part.replace(" ", "_")
        if canonical in genre_keywords:
            return canonical

    alias_map = _build_raw_alias_map()
    # 2) alias match
    for part in raw_parts:
        if part in alias_map and alias_map[part] in genre_keywords:
            return alias_map[part]

    # 3) overlap scoring against canonical names and configured keywords
    part_tokens = set()
    for part in raw_parts:
        part_tokens.update(_tokenize(part))
    if not part_tokens:
        return None

    scores: dict[str, float] = {}
    for genre, keywords in genre_keywords.items():
        score = 0.0
        genre_tokens = set(_tokenize(genre.replace("_", " ")))
        score += len(part_tokens & genre_tokens) * 2.0
        for kw in keywords:
            kw_toks = set(_tokenize(kw))
            if kw_toks and kw_toks.issubset(part_tokens):
                score += 1.5
            else:
                score += 0.5 * len(part_tokens & kw_toks)
        if score > 0:
            scores[genre] = score

    if not scores:
        return None
    return sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[0][0]


def _infer_genre_from_description(description: str, genre_keywords: dict[str, list[str]]) -> str | None:
    desc_tokens = _tokenize(description)
    desc_set = set(desc_tokens)
    scores: dict[str, float] = {}
    for genre, keywords in genre_keywords.items():
        score = 0.0
        for kw in keywords:
            k = kw.lower().strip().replace(" ", "_")
            if k in desc_set:
                score += 1.0
        if score > 0:
            scores[genre] = score

    if not scores:
        return None
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best_genre, best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0
    if best_score < 1.0:
        return None
    if (best_score - second_score < 0.5) and best_score < 2.5:
        return None
    return best_genre


def normalize_or_infer_genre(raw_genre: str | None, description: str, genre_keywords: dict[str, list[str]]) -> str | None:
    # Step 1: Prefer normalized source genre list from dataset.
    from_raw = _choose_genre_from_raw_list(raw_genre, genre_keywords)
    if from_raw:
        return from_raw
    # Step 2: Backfill from description when source genre list is missing/unclear.
    return _infer_genre_from_description(description, genre_keywords)
