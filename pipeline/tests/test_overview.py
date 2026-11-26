import json
from collections import Counter

import pytest

from tracklens import aggregates, config, data


@pytest.mark.skipif(not config.RAW_CSV.exists(), reason="raw CSV is not distributed")
def test_published_overview_reconciles_with_dataset():
    raw = data.load_raw(config.RAW_CSV)
    tracks, memberships, _ = data.canonicalise(raw)
    doc = json.loads((config.PUBLIC_DATA / "overview.json").read_text())
    assert doc["dataSha256"] == data.sha256(config.RAW_CSV)
    assert doc["uniqueTracks"] == raw["track_id"].nunique() == len(tracks)

    overlapping = memberships[memberships["track_id"].duplicated(keep=False)]
    first_id = overlapping.iloc[0]["track_id"]
    selected = overlapping[overlapping["track_id"] == first_id]["track_genre"].iloc[:2].tolist()
    ids = set(memberships.loc[memberships["track_genre"].isin(selected), "track_id"])
    genre_indices = {doc["genres"].index(genre) for genre in selected}
    for lo, hi in ((0, 0), (1, 100), (32, 67)):
        matching = tracks[tracks["track_id"].isin(ids) & tracks["popularity"].between(lo, hi)]
        expected = Counter(
            (int(pop), min(max(int(ms // (1000 * doc["durationBinSeconds"])), 0), doc["durationMaxBin"]))
            for pop, ms in zip(matching["popularity"], matching["duration_ms"], strict=True)
        )
        actual = Counter(
            (pop, duration)
            for combo in doc["combos"]
            if genre_indices.intersection(combo["g"])
            for pop, duration in aggregates.decode_cells(combo["cells"])
            if lo <= pop <= hi
        )
        assert actual == expected

    by_genre = memberships.merge(tracks[["track_id", "popularity"]], on="track_id")
    expected_counts = by_genre.groupby(["track_genre", "popularity"]).size().to_dict()
    actual_counts = {
        (genre, score): count
        for index, genre in enumerate(doc["genres"])
        for score, count in zip(doc["genrePop"]["pops"][index], doc["genrePop"]["n"][index], strict=True)
    }
    assert actual_counts == expected_counts
