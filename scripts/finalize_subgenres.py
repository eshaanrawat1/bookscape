#!/usr/bin/env python3
from __future__ import annotations

import argparse
import math
import json
import re
from pathlib import Path

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "artifacts"

STOP = {
    "the","a","an","and","or","to","of","in","on","for","with","at","from","by","book","books",
    "story","novel","series","author","about","into","through","over","under","after","before","during",
    "is","are","was","were","be","being","been","this","that","these","those","it","its","as","but"
}

BAD_SUFFIX_TOKENS = {
    "yang", "sich", "their", "there", "when", "will", "into", "they", "them", "than",
    "then", "from", "this", "that", "with", "have", "has", "had", "were", "been",
    "also", "just", "more", "most", "very", "some", "many", "much", "such", "over",
}

EXTRA_SUFFIX_VOCAB_BY_GENRE = {
    "fantasy": {"fae", "sorcery", "prophecy", "assassin", "heir", "court", "mythic"},
    "science_fiction": {"robot", "android", "quantum", "terraform", "colony", "signal", "protocol"},
    "mystery": {"forensic", "noir", "cold", "missing", "witness", "trial", "abduction"},
    "romance": {"slowburn", "friends", "workplace", "smalltown", "holiday", "forbidden", "marriage"},
    "history": {"biography", "revolution", "colonial", "diplomacy", "archaeology", "memoir"},
    "self_help": {"mindfulness", "resilience", "burnout", "coaching", "career", "habits"},
}


def tokenize(text: str) -> list[str]:
    return [w for w in re.sub(r"[^a-z0-9\s]", " ", (text or "").lower()).split() if len(w) >= 3 and w not in STOP]


def pretty_label(key: str) -> str:
    return " ".join([p.capitalize() for p in key.split("_")])

def title_case(s: str) -> str:
    return " ".join([p.capitalize() for p in (s or "").split() if p])


def canonical_subgenre_label(label: str) -> str:
    label = (label or "").strip()
    if "•" not in label:
        return label.lower()
    base, suffix = [x.strip() for x in label.split("•", 1)]
    toks = [t.lower() for t in tokenize(suffix) if t not in BAD_SUFFIX_TOKENS]
    toks = sorted(set(toks))
    if not toks:
        return base.lower()
    return f"{base.lower()} • {' '.join(toks)}"


def build_allowed_suffix_vocab(genre: str, candidates: dict[str, list[str]]) -> set[str]:
    vocab: set[str] = set()
    for kws in candidates.values():
        for kw in kws:
            vocab.update(tokenize(kw.replace("_", " ")))
    vocab.update(EXTRA_SUFFIX_VOCAB_BY_GENRE.get(genre, set()))
    return vocab


def load_inputs():
    with (ART / "books_globe.json").open("r", encoding="utf-8") as f:
        points = json.load(f)["points"]
    ids = np.load(ART / "book_ids.npy", allow_pickle=True).tolist()
    emb = np.load(ART / "embeddings.npy").astype(np.float32)
    return points, ids, emb


def build_maps(points, ids, emb):
    id_to_emb = {bid: emb[i] for i, bid in enumerate(ids) if i < len(emb)}
    by_genre: dict[str, list[dict]] = {}
    for p in points:
        by_genre.setdefault(p.get("genre", "unknown"), []).append(p)
    return id_to_emb, by_genre


def infer_label(items, genre: str, taxonomy: dict) -> str:
    candidates = taxonomy.get(genre, {})
    if not candidates:
        return "General"

    bag = []
    for x in items:
        bag.extend(tokenize(f"{x.get('title','')} {x.get('description','')}"))

    scores = {}
    for label, kws in candidates.items():
        s = 0
        for kw in kws:
            s += bag.count(kw)
        scores[label] = s

    best = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[0]
    if best[1] <= 0:
        return "General"
    return pretty_label(best[0])


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    na = np.linalg.norm(a) or 1.0
    nb = np.linalg.norm(b) or 1.0
    return float(np.dot(a / na, b / nb))


def keyword_score_for_book(book: dict, keywords: list[str]) -> float:
    text = f"{book.get('title','')} {book.get('description','')}"
    toks = set(tokenize(text))
    if not keywords:
        return 0.0
    hits = sum(1 for kw in keywords if kw in toks)
    return hits / len(keywords)


def assign_subgenres_taxonomy_first(
    points: list[dict],
    id_to_emb: dict[str, np.ndarray],
    taxonomy: dict[str, dict[str, list[str]]],
) -> dict[str, tuple[str, str]]:
    assignments: dict[str, tuple[str, str]] = {}
    by_genre: dict[str, list[dict]] = {}
    for p in points:
        by_genre.setdefault(p.get("genre", "unknown"), []).append(p)

    for genre, books in by_genre.items():
        candidates = taxonomy.get(genre, {})
        if not candidates:
            for b in books:
                assignments[b["id"]] = ("General", "general")
            continue

        # Build subgenre centroids from in-genre seed books selected by taxonomy keywords.
        centroids: dict[str, np.ndarray] = {}
        genre_vecs = [id_to_emb[b["id"]] for b in books if b.get("id") in id_to_emb]
        if not genre_vecs:
            for b in books:
                assignments[b["id"]] = ("General", "general")
            continue
        genre_centroid = np.mean(np.vstack(genre_vecs), axis=0)
        genre_centroid /= (np.linalg.norm(genre_centroid) or 1.0)

        for sub_key, kws in candidates.items():
            seed_vecs: list[np.ndarray] = []
            weights: list[float] = []
            for b in books:
                bid = b.get("id")
                if bid not in id_to_emb:
                    continue
                s = keyword_score_for_book(b, kws)
                if s <= 0.0:
                    continue
                seed_vecs.append(id_to_emb[bid])
                weights.append(s)
            if seed_vecs:
                arr = np.vstack(seed_vecs)
                w = np.array(weights, dtype=np.float32)
                c = (arr * w[:, None]).sum(axis=0) / max(float(w.sum()), 1e-6)
                c /= (np.linalg.norm(c) or 1.0)
                centroids[sub_key] = c
            else:
                centroids[sub_key] = genre_centroid

        # Assign each book by combined embedding similarity + lexical confidence.
        for b in books:
            bid = b.get("id")
            v = id_to_emb.get(bid)
            if v is None:
                assignments[bid] = ("General", "general")
                continue
            best_key = None
            best_score = -1e18
            for sub_key, kws in candidates.items():
                sim = cosine(v, centroids[sub_key])
                lex = keyword_score_for_book(b, kws)
                score = sim + (0.35 * lex)
                if score > best_score:
                    best_score = score
                    best_key = sub_key
            if best_key is None:
                assignments[bid] = ("General", "general")
            else:
                assignments[bid] = (pretty_label(best_key), best_key)
    return assignments


def cluster_token_counts(items: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for x in items:
        for t in tokenize(f"{x.get('title','')} {x.get('description','')}"):
            counts[t] = counts.get(t, 0) + 1
    return counts


def score_label_for_cluster(
    token_counts: dict[str, int],
    label_key: str,
    label_keywords: list[str],
    keyword_cluster_freq: dict[str, int],
    cluster_count: int,
) -> float:
    # Distinctiveness-aware score: local tf weighted by inverse cluster-frequency inside the same genre.
    score = 0.0
    for kw in label_keywords:
        tf = token_counts.get(kw, 0)
        if tf <= 0:
            continue
        # Smooth IDF over clusters in this genre.
        freq = keyword_cluster_freq.get(kw, 0)
        idf = math.log((1 + cluster_count) / (1 + freq)) + 1.0
        score += tf * idf

    # Slight prior for labels with more explicit taxonomy.
    score += min(len(label_keywords), 6) * 0.05
    return score


def assign_labels_for_genre(
    genre: str,
    clusters: list[tuple[int, list[dict]]],
    taxonomy: dict[str, dict[str, list[str]]],
) -> dict[int, str]:
    candidates = taxonomy.get(genre, {})
    if not candidates:
        return {cluster_id: "General" for cluster_id, _ in clusters}
    allowed_suffix_vocab = build_allowed_suffix_vocab(genre, candidates)

    token_by_cluster: dict[int, dict[str, int]] = {}
    token_cluster_freq: dict[str, int] = {}
    keyword_cluster_freq: dict[str, int] = {}
    cluster_count = len(clusters)

    for cluster_id, items in clusters:
        tc = cluster_token_counts(items)
        token_by_cluster[cluster_id] = tc
        present = set(tc.keys())
        for t in present:
            token_cluster_freq[t] = token_cluster_freq.get(t, 0) + 1
        for kw_list in candidates.values():
            for kw in kw_list:
                if kw in present:
                    keyword_cluster_freq[kw] = keyword_cluster_freq.get(kw, 0) + 1

    def pick_suffix_tokens(tc: dict[str, int], base_label: str | None = None, top_n: int = 2) -> list[str]:
        base_words = set(tokenize((base_label or "").replace("•", " ")))
        # Tokens that show up in almost every cluster are usually too generic to label variants.
        generic_tokens = {t for t, freq in token_cluster_freq.items() if freq >= max(2, int(cluster_count * 0.8))}
        scored: list[tuple[str, float]] = []
        for w, tf in tc.items():
            if len(w) < 4:
                continue
            if w in STOP or w in BAD_SUFFIX_TOKENS:
                continue
            if w in base_words:
                continue
            if w in generic_tokens:
                continue
            if not re.match(r"^[a-z0-9]+$", w):
                continue
            if not w.isascii():
                continue
            if tf < 2:
                continue
            # Keep suffixes anchored to controlled vocab so noise does not leak into labels.
            if w not in allowed_suffix_vocab:
                continue
            cf = token_cluster_freq.get(w, 1)
            idf = math.log((1 + cluster_count) / (1 + cf)) + 1.0
            scored.append((w, tf * idf))
        return [w for w, _ in sorted(scored, key=lambda x: x[1], reverse=True)[:top_n]]

    # Compute base scores.
    scores: dict[tuple[int, str], float] = {}
    for cluster_id, _ in clusters:
        tc = token_by_cluster[cluster_id]
        for label_key, keywords in candidates.items():
            scores[(cluster_id, label_key)] = score_label_for_cluster(
                tc, label_key, keywords, keyword_cluster_freq, cluster_count
            )

    # Diversity-constrained greedy assignment:
    # allow reuse, but penalize repeated use so other good labels surface.
    label_use: dict[str, int] = {k: 0 for k in candidates}
    max_soft_use = max(1, math.ceil(cluster_count / max(1, len(candidates))))
    assigned: dict[int, str] = {}

    # Hardest clusters first: those with the flattest score spread.
    order = []
    for cluster_id, _ in clusters:
        vals = sorted([scores[(cluster_id, lk)] for lk in candidates], reverse=True)
        margin = (vals[0] - vals[1]) if len(vals) > 1 else vals[0]
        order.append((margin, cluster_id))
    order.sort(key=lambda x: x[0])  # low margin first

    for _, cluster_id in order:
        best_label = None
        best_value = -1e18
        for label_key in candidates:
            base = scores[(cluster_id, label_key)]
            reuse = label_use[label_key]
            # Penalty ramps after soft cap.
            penalty = 0.0 if reuse < max_soft_use else (reuse - max_soft_use + 1) * 0.8
            value = base - penalty
            if value > best_value:
                best_value = value
                best_label = label_key

        if best_label is None or best_value <= 0:
            assigned[cluster_id] = "General"
        else:
            assigned[cluster_id] = pretty_label(best_label)
            label_use[best_label] += 1

    # Additional diversity pass: if one label repeats while alternatives are close, spread labels.
    if cluster_count >= 4:
        label_to_ids: dict[str, list[int]] = {}
        for cid, lbl in assigned.items():
            label_to_ids.setdefault(lbl, []).append(cid)

        dominant_label, dominant_ids = max(label_to_ids.items(), key=lambda kv: len(kv[1]))
        if len(dominant_ids) >= max(3, int(cluster_count * 0.5)):
            dom_key = next((k for k in candidates if pretty_label(k) == dominant_label), None)
            # weakest dominant assignments first
            dom_sorted = sorted(
                dominant_ids,
                key=lambda cid: scores.get((cid, dom_key), 0.0) if dom_key else 0.0
            )
            for cid in dom_sorted:
                ranked = sorted(
                    [(lk, scores[(cid, lk)]) for lk in candidates if pretty_label(lk) != dominant_label],
                    key=lambda x: x[1],
                    reverse=True,
                )
                if not ranked:
                    continue
                alt_key, alt_score = ranked[0]
                dom_score = scores.get((cid, dom_key), 0.0) if dom_key else 0.0
                # If alternative is reasonably close, reassign for variety.
                if alt_score >= max(0.5, dom_score * 0.65):
                    assigned[cid] = pretty_label(alt_key)
                    # stop once dominance drops enough
                    new_counts: dict[str, int] = {}
                    for _cid, _lbl in assigned.items():
                        new_counts[_lbl] = new_counts.get(_lbl, 0) + 1
                    if max(new_counts.values()) <= int(cluster_count * 0.45):
                        break

    # Rebalance when a single label dominates too heavily.
    label_to_clusters: dict[str, list[int]] = {}
    for cid, lbl in assigned.items():
        label_to_clusters.setdefault(lbl, []).append(cid)

    dominant_label, dominant_ids_all = max(label_to_clusters.items(), key=lambda kv: len(kv[1]))
    dominant_count = len(dominant_ids_all)
    if cluster_count >= 4 and dominant_count > int(cluster_count * 0.6):
        dominant_ids = label_to_clusters[dominant_label]

        # Relabel weakest dominant assignments first.
        def dominant_strength(cid: int) -> float:
            key = next((k for k in candidates if pretty_label(k) == dominant_label), None)
            return scores.get((cid, key), 0.0) if key else 0.0

        dominant_ids = sorted(dominant_ids, key=dominant_strength)
        target_relabeled = max(1, dominant_count - int(cluster_count * 0.55))

        for cid in dominant_ids[:target_relabeled]:
            # choose best non-dominant taxonomy label
            ranked = sorted(
                [(lk, scores[(cid, lk)]) for lk in candidates if pretty_label(lk) != dominant_label],
                key=lambda x: x[1],
                reverse=True,
            )
            if ranked and ranked[0][1] > 0:
                assigned[cid] = pretty_label(ranked[0][0])
                continue

            # fallback: cluster-distinct phrase label from local tokens
            tc = token_by_cluster.get(cid, {})
            tops = pick_suffix_tokens(tc, dominant_label, top_n=2)
            if tops:
                assigned[cid] = title_case(" ".join(tops))

    # Final variety pass: if multiple clusters still share the same label,
    # split weaker repeats into meaningful token-based variants.
    label_to_ids_final: dict[str, list[int]] = {}
    for cid, lbl in assigned.items():
        label_to_ids_final.setdefault(lbl, []).append(cid)

    for lbl, ids_for_label in label_to_ids_final.items():
        if len(ids_for_label) <= 1 or lbl == "General":
            continue
        # Keep strongest cluster on the base label; rename others.
        base_key = next((k for k in candidates if pretty_label(k) == lbl), None)
        ranked_ids = sorted(
            ids_for_label,
            key=lambda cid: scores.get((cid, base_key), 0.0) if base_key else 0.0,
            reverse=True,
        )
        for idx, cid in enumerate(ranked_ids[1:], start=1):
            tc = token_by_cluster.get(cid, {})
            tops = pick_suffix_tokens(tc, lbl, top_n=2)
            if tops:
                assigned[cid] = f"{lbl} • {title_case(' '.join(tops))}"
            else:
                assigned[cid] = f"{lbl} • Variant {idx+1}"

    # Final dedupe pass: collapse near-duplicate variant labels within this genre.
    # Example: "Modern History • Life World" and "Modern History • World Life" -> same canonical form.
    canon_to_label: dict[str, str] = {}
    deduped: dict[int, str] = {}
    for cid, lbl in assigned.items():
        canon = canonical_subgenre_label(lbl)
        if canon not in canon_to_label:
            canon_to_label[canon] = lbl
        deduped[cid] = canon_to_label[canon]

    return deduped


def maybe_reassign(points, id_to_emb, by_gc):
    # Build centroids per (genre,cluster), then reassign each book to nearest centroid within same genre.
    centroids = {}
    for key, items in by_gc.items():
        vecs = [id_to_emb[p["id"]] for p in items if p.get("id") in id_to_emb]
        if not vecs:
            continue
        c = np.mean(np.vstack(vecs), axis=0)
        n = np.linalg.norm(c)
        centroids[key] = c / n if n > 0 else c

    points_out = []
    for p in points:
        genre = p.get("genre", "unknown")
        v = id_to_emb.get(p.get("id"))
        if v is None:
            points_out.append(p)
            continue
        v = v / (np.linalg.norm(v) or 1.0)
        cand = [(k, c) for k, c in centroids.items() if k[0] == genre]
        if not cand:
            points_out.append(p)
            continue
        best_key = max(cand, key=lambda kv: float(np.dot(v, kv[1])))[0]
        p2 = dict(p)
        p2["cluster"] = int(best_key[1])
        points_out.append(p2)
    return points_out


def main():
    ap = argparse.ArgumentParser(description="Finalize stable, human-readable subgenres and assign best-fit clusters.")
    ap.add_argument("--taxonomy", default=str(ROOT / "config" / "subgenre_taxonomy.yaml"))
    ap.add_argument("--write", action="store_true", help="Write changes into artifacts/books_globe.json")
    args = ap.parse_args()

    with Path(args.taxonomy).open("r", encoding="utf-8") as f:
        taxonomy = yaml.safe_load(f) or {}

    points, ids, emb = load_inputs()
    id_to_emb, _ = build_maps(points, ids, emb)
    assignments = assign_subgenres_taxonomy_first(points, id_to_emb, taxonomy)

    final_points = []
    for p in points:
        genre = p.get("genre", "unknown")
        subgenre, sub_key = assignments.get(p.get("id"), ("General", "general"))
        p2 = dict(p)
        p2["subgenre"] = subgenre
        p2["subgenre_id"] = f"{genre}::{sub_key}"
        final_points.append(p2)

    if args.write:
        with (ART / "books_globe.json").open("w", encoding="utf-8") as f:
            json.dump({"points": final_points}, f, indent=2)

    print(f"books: {len(final_points)}")
    sample = final_points[:8]
    for x in sample:
        print(f"- {x.get('genre')} / {x.get('subgenre')} ({x.get('subgenre_id')})")


if __name__ == "__main__":
    main()
