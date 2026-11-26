import pandas as pd

from tracklens import data


def raw_frame(rows):
    base = dict(
        artists="A", album_name="Alb", track_name="Song", popularity=50, duration_ms=200000, explicit=False,
        danceability=0.5, energy=0.5, key=1, loudness=-6.0, mode=1, speechiness=0.05, acousticness=0.1,
        instrumentalness=0.0, liveness=0.1, valence=0.5, tempo=120.0, time_signature=4, track_genre="pop",
    )
    out = []
    for i, r in enumerate(rows):
        out.append({"row_index": i, **base, **r})
    return pd.DataFrame(out)


def test_repeated_pairs_dropped_and_memberships_kept():
    df = raw_frame([
        {"track_id": "a", "track_genre": "pop"},
        {"track_id": "a", "track_genre": "pop"},  # exact repeat of the pair
        {"track_id": "a", "track_genre": "rock"},
        {"track_id": "b", "track_genre": "rock"},
    ])
    tracks, memberships, rules = data.canonicalise(df)
    assert len(tracks) == 2
    assert rules["repeated_track_genre_pairs_dropped"] == 1
    assert sorted(memberships[memberships.track_id == "a"].track_genre) == ["pop", "rock"]
    assert int(tracks.set_index("track_id").loc["a", "genre_count"]) == 2


def test_popularity_conflict_uses_rounded_median_and_keeps_zero():
    df = raw_frame([
        {"track_id": "a", "track_genre": "pop", "popularity": 0},
        {"track_id": "a", "track_genre": "rock", "popularity": 3},
        {"track_id": "b", "track_genre": "rock", "popularity": 0},
        {"track_id": "c", "track_genre": "pop", "popularity": 10},
        {"track_id": "c", "track_genre": "rock", "popularity": 11},
        {"track_id": "c", "track_genre": "jazz", "popularity": 40},
    ])
    tracks, _, rules = data.canonicalise(df)
    t = tracks.set_index("track_id")
    assert t.loc["a", "popularity"] == 2  # median 1.5 rounds half up
    assert t.loc["b", "popularity"] == 0  # valid zero preserved
    assert t.loc["c", "popularity"] == 11
    assert rules["popularity_conflict_ids"] == 2
    assert rules["popularity_conflict_ids_with_a_zero_row"] == 1


def test_rule_does_not_depend_on_row_order():
    rows = [
        {"track_id": "a", "track_genre": "pop", "popularity": 20},
        {"track_id": "a", "track_genre": "rock", "popularity": 30},
        {"track_id": "a", "track_genre": "jazz", "popularity": 90},
    ]
    t1, _, _ = data.canonicalise(raw_frame(rows))
    t2, _, _ = data.canonicalise(raw_frame(rows[::-1]))
    assert t1.popularity.tolist() == t2.popularity.tolist() == [30]


def test_invalid_duration_flagged_not_dropped():
    df = raw_frame([{"track_id": "a", "track_genre": "pop", "duration_ms": 0}, {"track_id": "b", "track_genre": "pop"}])
    tracks, _, rules = data.canonicalise(df)
    assert len(tracks) == 2
    assert tracks.set_index("track_id").loc["a", "model_valid"] == False  # noqa: E712
    assert rules["model_invalid_tracks"] == 1


def test_duplicate_groups_link_title_artist_and_identical_features():
    df = raw_frame([
        {"track_id": "a", "track_genre": "pop", "track_name": "Hello  World", "artists": "Énna"},
        {"track_id": "b", "track_genre": "pop", "track_name": "hello world", "artists": "enna", "energy": 0.9},
        {"track_id": "c", "track_genre": "pop", "track_name": "Other", "artists": "X", "energy": 0.9},  # same features as b
        {"track_id": "d", "track_genre": "pop", "track_name": "Else", "artists": "Y", "energy": 0.2},
    ])
    tracks, _, _ = data.canonicalise(df)
    groups = data.assign_duplicate_groups(tracks)
    g = dict(zip(tracks.track_id, groups))
    assert g["a"] == g["b"] == g["c"]
    assert g["d"] != g["a"]


def test_normalise_text():
    assert data.normalise_text("  Beyoncé   Knowles ") == "beyonce knowles"
    assert data.normalise_text(None) == ""


def test_duplicate_grouping_preserves_nonconsecutive_labels():
    df = raw_frame([
        {"track_id": "a"},
        {"track_id": "b"},
    ])
    tracks, _, _ = data.canonicalise(df)
    tracks.index = [100, 300]
    groups = data.assign_duplicate_groups(tracks)
    assert groups.index.tolist() == [100, 300]
    assert groups.nunique() == 1
