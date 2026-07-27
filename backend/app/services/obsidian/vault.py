from __future__ import annotations

import os
from pathlib import Path

from ...repository import DataRepository

VAULT_PATH_KEY = "obsidian_vault_path"


def resolve_vault_path(root: Path) -> Path:
    env_value = os.getenv("OBSIDIAN_VAULT_PATH", "").strip()
    if env_value:
        return Path(env_value).expanduser()

    vault_path = DataRepository(root).get_setting(VAULT_PATH_KEY, "")
    if vault_path:
        return Path(vault_path).expanduser()

    raise FileNotFoundError("Obsidian vault path is not configured. Set it in Settings first.")
