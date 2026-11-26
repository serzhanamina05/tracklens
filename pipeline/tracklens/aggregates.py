"""Aggregate-only artifacts that are safe to publish.

Nothing in here contains a track ID, track name, artist or album. The smallest
unit is a count of tracks that share a genre combination, an integer popularity
score and a 5-second duration bin.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import config

GENRE_SUM_FEATURES = config.UNIT_FEATURES + ["tempo", "loudness", "duration_s", "explicit"]


# Decimal places kept for per-(genre, popularity) sums. Means derived from them
# are accurate to well under the precision shown on the site.
SUM_DECIMALS = {**{f: 2 for f in config.UNIT_FEATURES}, "tempo": 1, "loudness": 1, "duration_s": 0, "explicit": 0}


def _compact(x: float, nd: int) -> float | int:
    v = round(float(x), nd)
    return int(v) if nd == 0 or v == int(v) else v


def _r(x: float, nd: int = 4) -> float:
    return float(round(float(x), nd))


def duration_bin(duration_ms: pd.Series) -> pd.Series:
    b = (duration_ms / 1000 // config.DURATION_BIN_S).astype(int)
    return b.clip(0, config.DURATION_MAX_BIN)


def encode_cells(pops: pd.Series, dbins: pd.Series) -> list[int]:
    """Compact run encoding of (popularity, duration-bin) pairs for one combo.

    Layout: [pop, k, d1, d2-d1, d3-d2, ..., pop, k, ...] where pop ascends, k is the
    number of tracks with that score and the d values are their sorted duration
    bins, delta-encoded. Decoded by web/src/lib/overview.ts (decodeCells).
    """
    out: list[int] = []
    frame = pd.DataFrame({"p": pops.to_numpy(), "d": dbins.to_numpy()}).sort_values(["p", "d"], kind="stable")
    for p, part in frame.groupby("p", sort=True):
        d = part["d"].to_numpy()
        out.extend([int(p), int(len(d)), int(d[0])])
        out.extend(int(v) for v in np.diff(d))
    return out


def decode_cells(cells: list[int]) -> list[tuple[int, int]]:
    """Inverse of encode_cells; returns (pop, dbin) per track (used by tests)."""
    out, i = [], 0
    while i < len(cells):
        p, k = cells[i], cells[i + 1]
        d = 0
        for j in range(k):
            d = cells[i + 2] if j == 0 else d + cells[i + 2 + j]
            out.append((p, d))
        i += 2 + k
    return out


def build_overview(tracks: pd.DataFrame, memberships: pd.DataFrame, genres: list[str]) -> dict:
    gidx = {g: i for i, g in enumerate(genres)}
    combo_of = (
        memberships.assign(g=memberships["track_genre"].map(gidx))
        .groupby("track_id")["g"]
        .apply(lambda s: tuple(sorted(s)))
    )
    t = tracks.set_index("track_id")
    frame = pd.DataFrame(
        {
            "combo": combo_of.reindex(t.index),
            "pop": t["popularity"].astype(int),
            "dbin": duration_bin(t["duration_ms"]),
        }
    )
    combos = []
    for combo, part in frame.groupby("combo", sort=True):
        combos.append({"g": list(combo), "n": int(len(part)), "cells": encode_cells(part["pop"], part["dbin"])})

    # Membership-level genre x popularity tables (each genre counts its own tracks).
    m = memberships.merge(tracks, on="track_id", how="left")
    m["duration_s"] = m["duration_ms"] / 1000.0
    m["explicit"] = m["explicit"].astype(float)
    m["g"] = m["track_genre"].map(gidx)
    count = np.zeros((len(genres), 101), dtype=int)
    sums = {f: np.zeros((len(genres), 101)) for f in GENRE_SUM_FEATURES}
    grp = m.groupby(["g", "popularity"])
    sizes = grp.size()
    for (g, p), n in sizes.items():
        count[g, p] = n
    agg = grp[GENRE_SUM_FEATURES].sum()
    for (g, p), row in agg.iterrows():
        for f in GENRE_SUM_FEATURES:
            sums[f][g, p] = row[f]

    return {
        "schemaVersion": config.SCHEMA_VERSION,
        "genres": genres,
        "durationBinSeconds": config.DURATION_BIN_S,
        "durationMaxBin": config.DURATION_MAX_BIN,
        "uniqueTracks": int(len(tracks)),
        "combos": combos,
        "genrePop": {
            # Sparse per genre: the popularity scores that occur, and aligned arrays.
            "pops": [[int(p) for p in range(101) if count[g, p]] for g in range(len(genres))],
            "n": [[int(count[g, p]) for p in range(101) if count[g, p]] for g in range(len(genres))],
            "sums": {
                f: [[_compact(sums[f][g, p], SUM_DECIMALS[f]) for p in range(101) if count[g, p]] for g in range(len(genres))]
                for f in GENRE_SUM_FEATURES
            },
        },
    }


def _quantiles(s: pd.Series) -> dict:
    q = s.quantile([0.25, 0.5, 0.75])
    return {"q1": _r(q[0.25]), "median": _r(q[0.5]), "q3": _r(q[0.75]), "mean": _r(s.mean())}


def build_genres(
    tracks: pd.DataFrame,
    memberships: pd.DataFrame,
    genres: list[str],
    sim_mean: np.ndarray,
    sim_scale: np.ndarray,
) -> dict:
    m = memberships.merge(tracks, on="track_id", how="left")
    feats = config.UNIT_FEATURES + ["tempo", "loudness"]
    valid = tracks[tracks["model_valid"]]
    z_all = (valid[config.SIMILARITY_FEATURES].to_numpy() - sim_mean) / sim_scale
    genre_rows = []
    centroids = []
    genre_sizes = memberships.groupby("track_genre").size()
    multi = memberships.groupby("track_id").size()
    shared = memberships[memberships["track_id"].map(multi) > 1].groupby("track_genre").size()
    for g in genres:
        part = m[m["track_genre"] == g]
        pv = part[part["model_valid"]]
        z = (pv[config.SIMILARITY_FEATURES].to_numpy() - sim_mean) / sim_scale
        centroid = z.mean(axis=0)
        centroids.append(centroid)
        genre_rows.append(
            {
                "name": g,
                "tracks": int(genre_sizes[g]),
                "sharedTracks": int(shared.get(g, 0)),
                "popularity": {**_quantiles(part["popularity"]), "zeroShare": _r((part["popularity"] == 0).mean())},
                "durationMinutes": _quantiles(part["duration_ms"] / 60000.0),
                "explicitShare": _r(part["explicit"].mean()),
                "features": {f: _quantiles(part[f]) for f in feats},
                "modeMajorShare": _r(part["mode"].mean()),
                "centroid": [_r(v, 4) for v in centroid],
            }
        )
    C = np.array(centroids)
    D = np.sqrt(((C[:, None, :] - C[None, :, :]) ** 2).sum(axis=2))
    for i, row in enumerate(genre_rows):
        order = [j for j in np.argsort(D[i], kind="stable") if j != i][:6]
        row["neighbors"] = [{"genre": genres[j], "distance": _r(D[i, j], 3)} for j in order]

    overall = {
        "tracks": int(len(tracks)),
        "popularity": {**_quantiles(tracks["popularity"]), "zeroShare": _r((tracks["popularity"] == 0).mean())},
        "durationMinutes": _quantiles(tracks["duration_ms"] / 60000.0),
        "explicitShare": _r(tracks["explicit"].mean()),
        "features": {f: _quantiles(tracks[f]) for f in feats},
        "centroid": [_r(v, 4) for v in z_all.mean(axis=0)],
    }
    return {
        "schemaVersion": config.SCHEMA_VERSION,
        "denominator": "track-genre memberships (each genre counts its own tracks; a track in two genres counts in both)",
        "overallDenominator": "unique tracks",
        "genres": genre_rows,
        "overall": overall,
    }


def build_similarity_spec(mean: np.ndarray, scale: np.ndarray, fitted_on: int) -> dict:
    return {
        "schemaVersion": config.SCHEMA_VERSION,
        "features": config.SIMILARITY_FEATURES,
        "scaler": "StandardScaler (z-score) fitted on all model-valid canonical tracks",
        "fittedOn": fitted_on,
        "mean": [float(v) for v in mean],
        "scale": [float(v) for v in scale],
        "metric": "euclidean distance on z-scored features, all features weighted equally",
        "excluded": ["track_id", "track_name", "artists", "album_name", "popularity", "track_genre", "duration_ms", "explicit", "key", "mode", "time_signature"],
    }
