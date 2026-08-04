from __future__ import annotations

import os
from pathlib import Path

from ...repository import DataRepository

VAULT_PATH_KEY = "obsidian_vault_path"

_FORBIDDEN_TREES = (
    "/etc", "/usr", "/bin", "/sbin", "/var", "/dev", "/opt", "/boot",
    "/System", "/Library", "/Applications", "/private",
)

# iCloud Drive lives under ~/Library/Mobile Documents, and an iCloud-hosted
# vault is a case this app deliberately supports (see the note in
# routes/settings.py). So ~/Library is refused with this one carve-out rather
# than refused outright.
_ICLOUD_TREE = ("Library", "Mobile Documents")


def validate_vault_path(path: Path) -> None:
    """Raise ValueError if `path` is not somewhere a vault may reasonably live.

    Existence is deliberately not checked: a path on an unmounted drive or a
    not-yet-downloaded iCloud folder must still be configurable. Callers about
    to touch the disk check that separately.
    """
    if not path.is_absolute():
        raise ValueError(f"Vault path must be an absolute path: {path}")

    home = Path.home()
    if path in {Path(path.anchor), home, Path("/Users"), Path("/Volumes"), Path("/home")}:
        raise ValueError(
            f"{path} is too broad to sync — pick the folder your notes are in, "
            "not a drive or home directory."
        )

    for tree in _FORBIDDEN_TREES:
        forbidden = Path(tree)
        if path == forbidden or forbidden in path.parents:
            raise ValueError(f"{path} is a system directory — pick a folder in your documents.")

    if home in path.parents:
        relative = path.relative_to(home)
        head = relative.parts[0]
        if head.startswith("."):
            raise ValueError(
                f"{path} is a hidden configuration folder — pick a folder in your documents."
            )
        if head == "Library" and relative.parts[:2] != _ICLOUD_TREE:
            raise ValueError(f"{path} is a system directory — pick a folder in your documents.")


def resolve_vault_path(root: Path) -> Path:
    """The configured vault directory, normalised and validated."""
    env_value = os.getenv("OBSIDIAN_VAULT_PATH", "").strip()
    raw = env_value or DataRepository(root).get_setting(VAULT_PATH_KEY, "")

    if not raw:
        raise FileNotFoundError("Obsidian vault path is not configured. Set it in Settings first.")

    path = Path(raw).expanduser().resolve()
    validate_vault_path(path)
    return path
