"""Shared constants for the TrackLens offline pipeline.

Everything that the browser also relies on (feature order, validation bounds,
clipping) is defined here once and exported into the JSON artifacts, so the
Python evaluation and the UI apply exactly the same rules.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW_CSV = ROOT / "data" / "raw" / "dataset.csv"
PUBLIC_DATA = ROOT / "web" / "public" / "data"  # aggregate-only, committed, published
LOCAL_DATA = ROOT / "web" / "local-data"  # track-level, git-ignored, never published
DOCS = ROOT / "docs"
WEB_FIXTURES = ROOT / "web" / "src" / "lib" / "__fixtures__"

SCHEMA_VERSION = 1
SEED = 42

# Audio descriptors on a 0-1 scale.
UNIT_FEATURES = [
    "danceability",
    "energy",
    "speechiness",
    "acousticness",
    "instrumentalness",
    "liveness",
    "valence",
]

# Continuous features used for "sounds similar" distance. Identity, popularity,
# genre, duration and the categorical key/mode/time-signature are excluded.
SIMILARITY_FEATURES = [
    "danceability",
    "energy",
    "loudness",
    "speechiness",
    "acousticness",
    "instrumentalness",
    "liveness",
    "valence",
    "tempo",
]

# Predictors for the popularity model, in the exact order the exported model
# expects. Everything here can be entered in the browser. Identifiers, text,
# genre and anything derived from popularity are excluded.
MODEL_FEATURES = [
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
]

# Domain validation bounds (inclusive). They are fixed rather than learned from
# the data, so the same rule applies to training rows, test rows and UI input.
VALIDATION = {
    "duration_ms": {"min": 1_000, "max": 6_000_000, "integer": True, "unit": "ms"},
    "explicit": {"min": 0, "max": 1, "integer": True, "unit": "flag"},
    "danceability": {"min": 0.0, "max": 1.0, "integer": False, "unit": "0-1"},
    "energy": {"min": 0.0, "max": 1.0, "integer": False, "unit": "0-1"},
    "key": {"min": 0, "max": 11, "integer": True, "unit": "pitch class"},
    "loudness": {"min": -60.0, "max": 5.0, "integer": False, "unit": "dB"},
    "mode": {"min": 0, "max": 1, "integer": True, "unit": "flag"},
    "speechiness": {"min": 0.0, "max": 1.0, "integer": False, "unit": "0-1"},
    "acousticness": {"min": 0.0, "max": 1.0, "integer": False, "unit": "0-1"},
    "instrumentalness": {"min": 0.0, "max": 1.0, "integer": False, "unit": "0-1"},
    "liveness": {"min": 0.0, "max": 1.0, "integer": False, "unit": "0-1"},
    "valence": {"min": 0.0, "max": 1.0, "integer": False, "unit": "0-1"},
    "tempo": {"min": 0.0, "max": 250.0, "integer": False, "unit": "BPM"},
    "time_signature": {"min": 0, "max": 7, "integer": True, "unit": "beats/bar"},
}

OUTPUT_CLIP = (0.0, 100.0)

# Observed-popularity bands used for error breakdowns.
POPULARITY_BANDS = [(0, 0), (1, 20), (21, 40), (41, 60), (61, 80), (81, 100)]

# Overview duration histogram resolution (seconds per bin) and cap.
DURATION_BIN_S = 5
DURATION_MAX_BIN = 240  # 240 * 5 s = 20 min; longer tracks go to the last bin
