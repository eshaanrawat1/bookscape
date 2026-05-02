# Atlas MVP Blueprint

## Pipeline Modules

### `pipeline/ingest_openlibrary.py`
Purpose: Pull raw book records from Open Library into JSONL snapshots.
Functions:
- `fetch_openlibrary_subject(subject, limit)`
- `main()`

### `pipeline/preprocess_books.py`
Purpose: Clean text, infer/normalize genres, filter low-quality rows.
Functions:
- `clean_text(text)`
- `preprocess(rows)`
- `main()`

### `pipeline/embed_books.py`
Purpose: Build text blocks and embeddings for each book.
Functions:
- `build_text_block(book)`
- `embed_with_transformer(texts)`
- `embed_with_hash(texts)`
- `generate_embeddings(books)`
- `main()`

### `pipeline/cluster_project.py`
Purpose: Assign cluster labels and project books to 3D sphere coordinates.
Functions:
- `cluster_embeddings(embeddings)`
- `reduce_to_3d(embeddings)`
- `project_to_sphere(xyz, radius)`
- `main()`

### `pipeline/index_faiss.py`
Purpose: Build vector search index.
Functions:
- `build_index(embeddings, out_dir)`
- `main()`

### `pipeline/export_artifacts.py`
Purpose: Export unified globe payload and artifact manifest.
Functions:
- `main()`

### `scripts/run_mvp_pipeline.py`
Purpose: Orchestrate full offline pipeline in one command.
Functions:
- `run(cmd)`
- `main()`

## API Modules

### `api/app/store.py`
Purpose: Load artifacts and serve search/recommendation data operations.
Methods:
- `_load()`
- `has_data()`
- `get_book(book_id)`
- `search(query, limit)`
- `recommend(book_id, limit)`
- `random_cluster_point()`

### `api/app/main.py`
Purpose: FastAPI surface for frontend queries.
Endpoints:
- `GET /health`
- `GET /points`
- `GET /book/{book_id}`
- `GET /search`
- `GET /recommendations`
- `GET /cluster/random`

## Frontend Modules

### `web/src/App.jsx`
Purpose: MVP interaction shell (search, select, recommendations, teleport) + 3D canvas.
Components/Functions:
- `Points({ points, selectedId, onSelect })`
- `App()`
- `runSearch()`
- `loadRecs(bookId)`
- `selectBook(book)`
- `surprise()`

### `web/src/styles.css`
Purpose: visual direction, layout, and responsive panel/canvas styling.

## Current MVP Guarantees
- Works with bundled sample dataset (10 books).
- Produces embeddings, clusters, 3D coordinates, and artifact manifest.
- API can return points, search results, and recommendations.
- Frontend builds and renders points on a navigable globe.

## Next Steps (Post-MVP)
1. Replace fallback embeddings/index with full transformer + FAISS in production.
2. Add zoom-level LOD sampling endpoint behavior.
3. Move user states/reading path from local-only to persisted backend store.
4. Add update merge pipeline (`json2` into new versioned artifact build).
