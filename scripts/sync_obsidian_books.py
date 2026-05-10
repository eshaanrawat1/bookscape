from __future__ import annotations

from pathlib import Path

from api.app.obsidian_sync import run_obsidian_sync


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    res = run_obsidian_sync(root, dry_run=True)
    print(
        f"Synced Obsidian books from {res.vault_path}\n"
        f"Dry run: {res.dry_run}\n"
        f"Preview file: {res.preview_path}\n"
        f"Scanned: {res.scanned_files}\n"
        f"Parsed: {res.parsed_books}\n"
        f"Created: {res.created_books}\n"
        f"Updated: {res.updated_books}\n"
        f"Progress entries updated: {res.updated_progress_entries}\n"
        f"Bracket-author entries removed: {res.removed_bracket_author_entries}"
    )


if __name__ == "__main__":
    main()
