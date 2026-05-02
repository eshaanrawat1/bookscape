from __future__ import annotations

import argparse
import re
import unicodedata
from pathlib import Path

from .common import DATA_PROCESSED, PipelineStats, read_jsonl, write_jsonl
from .genres import load_genre_keywords, normalize_or_infer_genre


def clean_text(text: str) -> str:
    text = text or ""
    text = re.sub(r"\s+", " ", text).strip()
    return text


NON_ENGLISH_MARKERS = (
    "edicion",
    "edición",
    "espanol",
    "español",
    "traduccion",
    "traducción",
    "portugues",
    "português",
    "francais",
    "français",
    "deutsch",
    "italiano",
    "рус",
)

EN_STOPWORDS = {
    "the", "and", "to", "of", "in", "a", "for", "is", "on", "with", "that", "as",
    "her", "his", "she", "he", "their", "this", "from", "at", "by", "an", "be",
}

NON_EN_STOPWORDS = {
    # Dutch / Afrikaans
    "de", "het", "een", "en", "van", "voor", "met", "op", "in", "te", "zijn",
    # Spanish / Portuguese
    "el", "la", "los", "las", "una", "un", "con", "para", "por", "que", "como",
    "mais", "uma", "dos", "das",
    # French / German / Italian
    "les", "des", "une", "dans", "und", "der", "die", "das", "mit", "per", "che",
}

DUTCH_STRONG_MARKERS = {
    "heeft", "maar", "samen", "ooit", "meer", "zijn", "haar", "hun", "komt", "arena",
    "regels", "winnaar", "district",
}


def normalize_token(text: str) -> str:
    text = (text or "").strip().lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9\s|]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def primary_author(author: str) -> str:
    return normalize_token((author or "").split("|")[0])


def english_likeness_score(title: str, desc: str) -> int:
    t = f"{title} {desc}".lower()
    score = 0
    # Prefer entries without obvious non-English/translation markers.
    if any(marker in t for marker in NON_ENGLISH_MARKERS):
        score -= 6
    # Prefer mostly-ascii text (heuristic for this dataset).
    ascii_chars = sum(1 for ch in t if ord(ch) < 128)
    if t:
        ratio = ascii_chars / max(1, len(t))
        if ratio > 0.98:
            score += 2
        elif ratio < 0.9:
            score -= 2
    # Mild boost for common English function words in title/desc.
    if re.search(r"\b(the|and|with|from|for|to|of)\b", t):
        score += 1
    return score


def likely_non_english_entry(title: str, desc: str) -> bool:
    t = (title or "").strip()
    d = (desc or "").strip()
    combined = f"{t} {d}".lower()
    if any(marker in combined for marker in NON_ENGLISH_MARKERS):
        return True

    # If title is bilingual like "Alacakaranlık / Twilight", drop the non-English side.
    if "/" in t:
        parts = [x.strip() for x in t.split("/") if x.strip()]
        if len(parts) >= 2:
            left, right = parts[0], parts[1]
            left_ascii = all(ord(ch) < 128 for ch in left)
            right_ascii = all(ord(ch) < 128 for ch in right)
            if (not left_ascii and right_ascii) or (left_ascii and not right_ascii):
                return True

    # Non-ascii-heavy title is likely non-English for this source dataset.
    if t:
        non_ascii = sum(1 for ch in t if ord(ch) >= 128)
        if non_ascii >= 1:
            return True

    # Description-level language heuristic (stronger than title for latin-script languages).
    d_norm = normalize_token(d)
    tokens = [w for w in d_norm.split() if len(w) >= 2]
    if tokens:
        en_hits = sum(1 for w in tokens if w in EN_STOPWORDS)
        non_en_hits = sum(1 for w in tokens if w in NON_EN_STOPWORDS)
        dutch_hits = sum(1 for w in tokens if w in DUTCH_STRONG_MARKERS)
        sample = min(len(tokens), 120)
        # If a decent sample has almost no English glue words but many non-English glue words,
        # treat as non-English description.
        if sample >= 25 and en_hits <= max(1, int(sample * 0.01)) and non_en_hits >= max(3, int(sample * 0.04)):
            return True
        # Strong Dutch lexical signal (helps cases like "Vlammen").
        if sample >= 25 and dutch_hits >= 4:
            return True
    return False


def preprocess(rows: list[dict]) -> tuple[list[dict], PipelineStats]:
    genre_keywords = load_genre_keywords()
    staged: list[dict] = []

    for row in rows:
        title = clean_text(row.get("title", ""))
        author = clean_text(row.get("author", ""))
        description = clean_text(row.get("description", ""))

        if not title or not author or len(description) < 20:
            continue

        genre = normalize_or_infer_genre(row.get("genres"), description, genre_keywords)
        if not genre:
            continue

        # Global language gate: remove clearly non-English entries even when no close duplicate exists.
        if likely_non_english_entry(title, description):
            continue

        staged.append(
            {
                "id": row.get("id", ""),
                "title": title,
                "author": author,
                "description": description,
                "genre": genre,
                "book_pages": row.get("book_pages"),
                "book_rating": row.get("book_rating"),
                "book_rating_count": row.get("book_rating_count"),
                "book_review_count": row.get("book_review_count"),
                "image_url": row.get("image_url"),
            }
        )
    # Rule 0: hard dedupe by id first (same title+author hash can appear with updated stats).
    by_id: dict[str, list[dict]] = {}
    for b in staged:
        book_id = b.get("id")
        if not book_id:
            continue
        by_id.setdefault(book_id, []).append(b)

    staged_id_deduped: list[dict] = []
    for _, group in by_id.items():
        if len(group) == 1:
            staged_id_deduped.append(group[0])
            continue
        best = max(
            group,
            key=lambda x: (
                x.get("book_review_count") if x.get("book_review_count") is not None else -1,
                x.get("book_rating_count") if x.get("book_rating_count") is not None else -1,
                english_likeness_score(x.get("title", ""), x.get("description", "")),
            ),
        )
        staged_id_deduped.append(best)

    # Rule 1: group by exact (ratings, reviews). In duplicate groups, drop non-English variants.
    by_counts: dict[tuple[int | None, int | None], list[dict]] = {}
    for b in staged_id_deduped:
        sig = (b.get("book_rating_count"), b.get("book_review_count"))
        by_counts.setdefault(sig, []).append(b)

    filtered: list[dict] = []
    for (ratings, reviews), group in by_counts.items():
        if len(group) <= 1 or ratings is None or reviews is None:
            filtered.extend(group)
            continue
        for b in group:
            if likely_non_english_entry(b.get("title", ""), b.get("description", "")):
                continue
            filtered.append(b)

    # Rule 1b (fallback): same primary author + same review count + near-identical rating count.
    # This catches translation duplicates where rating_count drifts slightly but reviews match exactly.
    by_author_reviews: dict[tuple[str, int | None], list[dict]] = {}
    for b in filtered:
        sig = (primary_author(b.get("author", "")), b.get("book_review_count"))
        by_author_reviews.setdefault(sig, []).append(b)

    filtered2: list[dict] = []
    for (_, review_count), group in by_author_reviews.items():
        if len(group) <= 1 or review_count is None:
            filtered2.extend(group)
            continue
        english = [x for x in group if not likely_non_english_entry(x.get("title", ""), x.get("description", ""))]
        if not english:
            filtered2.extend(group)
            continue

        keep_group: list[dict] = []
        for b in group:
            if not likely_non_english_entry(b.get("title", ""), b.get("description", "")):
                keep_group.append(b)
                continue
            b_rating = b.get("book_rating_count")
            # Drop non-English entries only when they are very close to an English counterpart.
            close_english_match = any(
                (e.get("book_rating_count") is not None)
                and (b_rating is not None)
                and abs(int(e.get("book_rating_count")) - int(b_rating)) <= 500
                for e in english
            )
            if not close_english_match:
                keep_group.append(b)
        filtered2.extend(keep_group)

    # Rule 1c (near-match fallback): same author + very close counts -> keep most English-like.
    by_author: dict[str, list[dict]] = {}
    for b in filtered2:
        by_author.setdefault(primary_author(b.get("author", "")), []).append(b)

    filtered3: list[dict] = []
    for _, group in by_author.items():
        if len(group) <= 1:
            filtered3.extend(group)
            continue

        consumed = set()
        for i, base in enumerate(group):
            if i in consumed:
                continue
            cluster = [i]
            for j in range(i + 1, len(group)):
                if j in consumed:
                    continue
                a_rc = base.get("book_rating_count")
                a_rv = base.get("book_review_count")
                b_rc = group[j].get("book_rating_count")
                b_rv = group[j].get("book_review_count")
                if None in (a_rc, a_rv, b_rc, b_rv):
                    continue
                # Close-count duplicate heuristic:
                # reviews nearly equal AND ratings nearly equal (absolute + relative).
                reviews_close = abs(int(a_rv) - int(b_rv)) <= 80
                ratings_close_abs = abs(int(a_rc) - int(b_rc)) <= 1200
                denom = max(int(a_rc), int(b_rc), 1)
                ratings_close_rel = (abs(int(a_rc) - int(b_rc)) / denom) <= 0.004
                if reviews_close and (ratings_close_abs or ratings_close_rel):
                    cluster.append(j)

            if len(cluster) == 1:
                filtered3.append(base)
                consumed.add(i)
                continue

            members = [group[k] for k in cluster]
            best = max(
                members,
                key=lambda x: (
                    english_likeness_score(x.get("title", ""), x.get("description", "")),
                    x.get("book_review_count") if x.get("book_review_count") is not None else -1,
                    x.get("book_rating_count") if x.get("book_rating_count") is not None else -1,
                ),
            )
            filtered3.append(best)
            for k in cluster:
                consumed.add(k)

    # Rule 2: secondary dedupe safety net by (primary author + same ratings/reviews).
    by_signature: dict[tuple[str, int | None, int | None], list[dict]] = {}
    for b in filtered3:
        sig = (primary_author(b.get("author", "")), b.get("book_rating_count"), b.get("book_review_count"))
        by_signature.setdefault(sig, []).append(b)

    out: list[dict] = []
    for _, group in by_signature.items():
        if len(group) == 1:
            out.append(group[0])
            continue
        best = max(
            group,
            key=lambda x: (
                english_likeness_score(x.get("title", ""), x.get("description", "")),
                len(x.get("description", "")),
                len(x.get("title", "")),
            ),
        )
        out.append(best)

    return out, PipelineStats(total_rows=len(rows), kept_rows=len(out))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", default=str(DATA_PROCESSED / "books_clean.jsonl"))
    args = parser.parse_args()

    rows = read_jsonl(Path(args.input))
    clean_rows, stats = preprocess(rows)
    write_jsonl(Path(args.out), clean_rows)
    print(f"preprocessed rows total={stats.total_rows} kept={stats.kept_rows}")


if __name__ == "__main__":
    main()
