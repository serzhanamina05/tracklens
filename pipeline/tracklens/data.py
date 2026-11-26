"""Loading, profiling and canonicalising the raw CSV.

Outputs two tables:

* ``tracks``      one row per unique ``track_id`` (the canonical track dataset)
* ``memberships`` one row per unique (track_id, track_genre) pair

Rules (documented in docs/data-notes.md):

1. Exact repeats of a (track_id, track_genre) pair are dropped, keeping the row
   with the lowest original row index.
2. All descriptive and audio columns are required to agree across the rows of an
   ID. If they ever disagree, the value from the lowest original row index wins
   and the disagreement is counted in the profile.
3. ``popularity`` is the only column that disagrees in the supplied file. The
   canonical value is the median of the remaining per-genre rows for that ID,
   rounded half up to an integer. Zero is a valid score and is kept.
4. A row is flagged ``model_valid = False`` when it fails the domain validation
   rules in config.VALIDATION (in this file: one row with 0 ms duration). Such
   rows stay in the descriptive analytics but are excluded from modelling and
   similarity search.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from pathlib import Path

import numpy as np
import pandas as pd

from . import config

EXPECTED_COLUMNS = [
    "track_id",
    "artists",
    "album_name",
    "track_name",
    "popularity",
    "duration_ms",
    "explicit",
    "danceability",
    "energy",
    "key",
    "loudness",
    "mode",
    "speechiness",
    "acousticness",
    "instrumentalness",
    "liveness",
    "valence",
    "tempo",
    "time_signature",
    "track_genre",
]
TEXT_COLUMNS = ["artists", "album_name", "track_name"]
STABLE_COLUMNS = [c for c in EXPECTED_COLUMNS if c not in ("track_id", "track_genre", "popularity")]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_raw(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    unnamed = [c for c in df.columns if c.startswith("Unnamed")]
    if len(unnamed) != 1:
        raise ValueError(f"expected exactly one unnamed index column, found {unnamed}")
    df = df.rename(columns={unnamed[0]: "row_index"})
    missing = [c for c in EXPECTED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"missing columns: {missing}")
    explicit = df["explicit"].astype("string").str.strip().str.lower().map(
        {"true": True, "false": False, "1": True, "0": False}
    )
    if explicit.isna().any():
        raise ValueError("explicit must contain only true/false or 1/0")
    df["explicit"] = explicit.astype(bool)
    for column in ("track_id", "track_genre"):
        if df[column].isna().any() or df[column].astype("string").str.strip().eq("").any():
            raise ValueError(f"{column} must be present on every row")
    popularity = pd.to_numeric(df["popularity"], errors="coerce")
    if not (popularity.between(0, 100) & (popularity % 1 == 0)).all():
        raise ValueError("popularity must be a whole number between 0 and 100")
    df["popularity"] = popularity.astype(int)
    return df


def normalise_text(value: object) -> str:
    """Lower-case, accent-stripped, whitespace-collapsed text used for grouping."""
    if not isinstance(value, str):
        return ""
    s = unicodedata.normalize("NFKD", value)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r"\s+", " ", s.lower()).strip()
    return s


def validate_rows(frame: pd.DataFrame) -> pd.Series:
    """Boolean mask of rows that satisfy config.VALIDATION for every model feature."""
    ok = pd.Series(True, index=frame.index)
    for feature, rule in config.VALIDATION.items():
        values = frame[feature].astype(float)
        ok &= values.between(rule["min"], rule["max"]) & values.notna()
        if rule["integer"]:
            ok &= values.eq(np.round(values))
    return ok


def round_half_up(x: pd.Series) -> pd.Series:
    return np.floor(x + 0.5).astype(int)


def canonicalise(raw: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    df = raw.sort_values("row_index", kind="stable")
    repeated_pairs = int(df.duplicated(["track_id", "track_genre"]).sum())
    pairs = df.drop_duplicates(["track_id", "track_genre"], keep="first")

    grouped = pairs.groupby("track_id", sort=False)
    conflicts = {}
    for col in STABLE_COLUMNS + ["popularity"]:
        conflicts[col] = int((grouped[col].nunique(dropna=False) > 1).sum())

    # Positional first row (lowest row index) per ID. ``groupby.first`` is not
    # used because it skips NaN and could mix values from different rows.
    first_rows = pairs.drop_duplicates("track_id", keep="first").set_index("track_id")
    tracks = first_rows[STABLE_COLUMNS + ["row_index"]].copy()

    pop_stats = grouped["popularity"].agg(["median", "min", "max", "size"]).reindex(tracks.index)
    tracks["popularity"] = round_half_up(pop_stats["median"]).astype(int)
    tracks["popularity_min"] = pop_stats["min"].astype(int)
    tracks["popularity_max"] = pop_stats["max"].astype(int)
    tracks["genre_count"] = pop_stats["size"].astype(int)
    tracks = tracks.reset_index()
    tracks["model_valid"] = validate_rows(tracks)
    for col in TEXT_COLUMNS:
        tracks[col] = tracks[col].astype("object").where(tracks[col].notna(), None)

    memberships = pairs[["track_id", "track_genre"]].reset_index(drop=True)

    pop_conflict = tracks["popularity_min"] != tracks["popularity_max"]
    zero_conflict = pop_conflict & (tracks["popularity_min"] == 0)
    rules = {
        "repeated_track_genre_pairs_dropped": repeated_pairs,
        "ids_with_conflicting_values": conflicts,
        "popularity_conflict_ids": int(pop_conflict.sum()),
        "popularity_conflict_max_spread": int((tracks["popularity_max"] - tracks["popularity_min"]).max()),
        "popularity_conflict_ids_with_a_zero_row": int(zero_conflict.sum()),
        "model_invalid_tracks": int((~tracks["model_valid"]).sum()),
    }
    return tracks, memberships, rules


def assign_duplicate_groups(tracks: pd.DataFrame) -> pd.Series:
    """Union-find grouping of IDs that are clearly the same recording.

    Two IDs are linked when either
      * their normalised artist string and normalised track name both match
        (and the name is not empty), or
      * all nine similarity features plus duration_ms match exactly.
    The group label is the smallest canonical position in the group.
    """
    original_index = tracks.index
    tracks = tracks.reset_index(drop=True)
    n = len(tracks)
    parent = np.arange(n)

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union_by(keys: pd.Series) -> None:
        for _, idx in keys.groupby(keys, sort=False).groups.items():
            idx = list(idx)
            if len(idx) < 2:
                continue
            root = find(idx[0])
            for j in idx[1:]:
                rj = find(j)
                if rj != root:
                    lo, hi = sorted((root, rj))
                    parent[hi] = lo
                    root = lo

    names = tracks["track_name"].map(normalise_text)
    artists = tracks["artists"].map(normalise_text)
    name_key = (artists + "␟" + names).where((names != "") & (artists != ""), None)
    union_by(name_key.dropna())

    feat_cols = config.SIMILARITY_FEATURES + ["duration_ms"]
    feat_key = tracks.loc[tracks["model_valid"], feat_cols].apply(tuple, axis=1)
    union_by(feat_key)

    return pd.Series([find(i) for i in range(n)], index=original_index, name="dup_group")


def profile(raw: pd.DataFrame, tracks: pd.DataFrame, memberships: pd.DataFrame, rules: dict) -> dict:
    numeric = [
        "popularity",
        "duration_ms",
        "danceability",
        "energy",
        "key",
        "loudness",
        "mode",
        "speechiness",
        "acousticness",
        "instrumentalness",
        "liveness",
        "valence",
        "tempo",
        "time_signature",
    ]
    ranges = {
        c: {
            "min": float(raw[c].min()),
            "max": float(raw[c].max()),
            "mean": round(float(raw[c].mean()), 4),
        }
        for c in numeric
    }
    ids_per_row = raw.groupby("track_id").size()
    genres_per_track = memberships.groupby("track_id").size()
    return {
        "rows": int(len(raw)),
        "columns": [c for c in raw.columns],
        "unique_track_ids": int(raw["track_id"].nunique()),
        "genres": int(raw["track_genre"].nunique()),
        "missing_values": {c: int(v) for c, v in raw.isna().sum().items() if v > 0},
        "ids_on_multiple_rows": int((ids_per_row > 1).sum()),
        "max_rows_per_id": int(ids_per_row.max()),
        "memberships": int(len(memberships)),
        "tracks_in_multiple_genres": int((genres_per_track > 1).sum()),
        "max_genres_per_track": int(genres_per_track.max()),
        "zero_popularity_rows": int((raw["popularity"] == 0).sum()),
        "zero_popularity_tracks": int((tracks["popularity"] == 0).sum()),
        "zero_popularity_memberships": None,  # filled by caller after merge
        "explicit_share_tracks": round(float(tracks["explicit"].mean()), 4),
        "tempo_zero_tracks": int((tracks["tempo"] == 0).sum()),
        "time_signature_zero_tracks": int((tracks["time_signature"] == 0).sum()),
        "feature_ranges_rows": ranges,
        "rules": rules,
    }
