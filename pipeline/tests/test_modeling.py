import json
import math

import numpy as np
import pandas as pd
import pytest

from tracklens import aggregates, config, modeling

MODEL = config.PUBLIC_DATA / "model.json"
FIXTURES = config.WEB_FIXTURES / "parity.json"


def test_split_keeps_groups_together_and_is_deterministic():
    rng = np.random.default_rng(0)
    frame = pd.DataFrame({"dup_group": rng.integers(0, 400, size=3000)})
    s1, s2 = modeling.split(frame), modeling.split(frame)
    assert (s1 == s2).all()
    assert (frame.assign(s=s1).groupby("dup_group")["s"].nunique() == 1).all()
    shares = s1.value_counts(normalize=True)
    assert abs(shares["train"] - 0.70) < 0.05 and abs(shares["test"] - 0.15) < 0.05


def test_validation_rules():
    good = {f: config.VALIDATION[f]["min"] for f in config.MODEL_FEATURES}
    assert modeling.validate_input(good) == []
    assert modeling.validate_input({**good, "energy": 1.01})[0].startswith("energy")
    assert modeling.validate_input({**good, "key": 1.5})[0].startswith("key")
    assert modeling.validate_input({**good, "tempo": math.nan})[0].startswith("tempo")
    assert modeling.validate_input({**good, "tempo": None})[0].startswith("tempo")


def test_clip():
    assert modeling.clip(np.array([-3.0, 50.0, 120.0])).tolist() == [0.0, 50.0, 100.0]


def test_cell_encoding_round_trip():
    pops = pd.Series([5, 0, 5, 5, 99, 0])
    dbins = pd.Series([40, 10, 38, 40, 240, 10])
    enc = aggregates.encode_cells(pops, dbins)
    assert sorted(aggregates.decode_cells(enc)) == sorted(zip(pops, dbins))


def test_exported_model_matches_fixtures():
    spec = json.loads(MODEL.read_text())
    fx = json.loads(FIXTURES.read_text())
    assert spec["features"] == config.MODEL_FEATURES
    assert spec["validation"] == json.loads(json.dumps(config.VALIDATION))
    for key in ("dataSha256", "buildId", "schemaVersion"):
        assert fx[key] == spec[key]
    for case in fx["valid"]:
        x = [float(case["input"][f]) for f in spec["features"]]
        assert modeling.validate_input(case["input"]) == []
        assert abs(modeling.predict_exported_raw(spec, x) - case["expectedRaw"]) <= fx["tolerance"]
        got = modeling.predict_exported(spec, x)
        assert abs(got - case["expected"]) <= fx["tolerance"], case["name"]
        assert 0 <= got <= 100
    for case in fx["invalid"]:
        problems = modeling.validate_input({**case["base"], **case["patch"]})
        assert any(p.startswith(case["field"]) for p in problems), case["name"]


@pytest.mark.skipif(not config.RAW_CSV.exists(), reason="raw CSV is not distributed")
def test_exported_model_matches_sklearn_on_real_rows():
    """Fit small models on real rows to exercise all exporter families."""
    from tracklens import data

    raw = data.load_raw(config.RAW_CSV).sample(n=4000, random_state=config.SEED)
    tracks, _, _ = data.canonicalise(raw)
    tracks = tracks[tracks.model_valid].reset_index(drop=True)
    y = tracks.popularity.to_numpy(float)
    for factory, family in ((lambda: modeling.FrameHGB(max_iter=20, max_leaf_nodes=15), "hgb"), (lambda: modeling.RidgeModel(1.0), "ridge"), (modeling.FrameDummy, "baseline")):
        est = factory().fit(tracks, y)
        spec = modeling.export_model({"family": family, "label": family, "params": {}, "_est": est}, len(tracks))
        sk = modeling.clip(est.predict(tracks))
        mine = np.array([modeling.predict_exported(spec, row) for row in modeling.matrix(tracks).tolist()])
        assert np.max(np.abs(sk - mine)) < 1e-9, family
