# Atlas MVP Blueprint

Minimal vertical slice for a 3D book discovery engine.

## Structure

- `pipeline/`: offline data + ML pipeline
- `api/`: FastAPI backend for search/recommendations/points
- `web/`: React + Three.js frontend globe
- `backend/data/`: unified data root (`raw/`, `processed/`, `runtime/`, `build/`)

## Quickstart (minimal sample)

1. Create env and install minimal deps:
  - `python3 -m venv .venv && source .venv/bin/activate`
  - `pip install -r requirements.txt` 
2. Build artifacts from bundled sample books:
  - `python scripts/rebuild_dashboard_data.py --input backend/data/raw/sample_books.jsonl`
3. Run API:
  - `uvicorn api.app.main:app --reload --port 8000`
4. Run web app (in separate shell):
  - `cd web && npm install && npm run dev`

## Optional full ML stack

- Install extras for HDBSCAN/UMAP/FAISS/transformer embeddings:
  - `pip install -r requirements-full.txt`

## Notes

- Embeddings: attempts `all-MiniLM-L6-v2`, falls back to deterministic hashing embeddings if unavailable.
- Vector store: attempts FAISS, falls back to numpy cosine search for local verification.
- User state is intentionally local-only (MVP, no auth).
