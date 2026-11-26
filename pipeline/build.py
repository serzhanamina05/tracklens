"""Regenerate every TrackLens artifact from the raw CSV.

    python pipeline/build.py                       # uses data/raw/dataset.csv
    python pipeline/build.py --csv /path/to/file.csv
    python pipeline/build.py --skip-local          # aggregate artifacts only

Writes
  web/public/data/*.json             aggregate-only, committed, published
  web/local-data/*.json              track-level, git-ignored, local full mode only
  web/src/lib/__fixtures__/parity.json   synthetic parity fixtures (no real records)
  docs/model-card.md, docs/data-notes.md
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sys
from tempfile import TemporaryDirectory
import time
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tracklens import aggregates, config, data, modeling  # noqa: E402
from tracklens.report import write_data_notes, write_model_card  # noqa: E402


def dump(obj, path: Path, indent: int | None = None) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, indent=indent, separators=None if indent else (",", ":"), ensure_ascii=False, allow_nan=False)
    path.write_text(text + "\n", encoding="utf-8")
    return len(text.encode())


def log(msg: str) -> None:
    print(msg, flush=True)


def model_defaults(frame: pd.DataFrame) -> dict:
    defaults = {}
    for feature in config.MODEL_FEATURES:
        median = float(frame[feature].median())
        rule = config.VALIDATION[feature]
        defaults[feature] = round(median) if rule["integer"] else median
    return defaults


def verify_predictions(spec: dict, estimator, frame: pd.DataFrame) -> float:
    expected = estimator.predict(frame)
    exported = np.array([
        modeling.predict_exported_raw(spec, vector)
        for vector in modeling.matrix(frame).tolist()
    ])
    difference = float(np.max(np.abs(expected - exported)))
    if not np.isfinite(difference) or difference > 1e-9:
        raise ValueError(f"Model export differed from estimator by {difference:.3g}")
    return difference


def parity_fixtures(spec: dict, estimator) -> dict:
    """Generate valid probes and malformed inputs shared with the browser tests."""
    rules = spec["validation"]
    defaults = spec["defaults"]
    rng = np.random.default_rng(config.SEED)
    inputs = {"training medians": defaults}
    for feature, rule in rules.items():
        for edge in ("min", "max"):
            inputs[f"{feature} at {edge}"] = {**defaults, feature: rule[edge]}
    for index in range(40):
        values = {feature: float(rng.uniform(rule["min"], rule["max"])) for feature, rule in rules.items()}
        inputs[f"random {index + 1}"] = {
            feature: round(value) if rules[feature]["integer"] else value
            for feature, value in values.items()
        }
    for index, tree in enumerate(spec.get("trees", [])[:24]):
        if tree["f"][0] == -1:
            continue
        # The root is reached for every input, regardless of other feature values.
        feature = spec["features"][tree["f"][0]]
        threshold = tree["t"][0]
        values = (math.nextafter(threshold, -math.inf), threshold, math.nextafter(threshold, math.inf))
        if rules[feature]["integer"]:
            values = (math.floor(threshold), math.floor(threshold) + 1)
        for side, value in enumerate(values):
            probe = {**defaults, feature: value}
            if not modeling.validate_input(probe):
                inputs[f"tree {index} root boundary {side}"] = probe

    for name, values in inputs.items():
        if modeling.validate_input(values):
            raise ValueError(f"Invalid parity fixture: {name}")
    frame = pd.DataFrame(inputs.values())
    verify_predictions(spec, estimator, frame)
    raw = estimator.predict(frame)
    valid = [
        {"name": name, "input": values, "expectedRaw": float(pred), "expected": float(clipped)}
        for (name, values), pred, clipped in zip(inputs.items(), raw, modeling.clip(raw), strict=True)
    ]
    invalid = []
    for field, value in (("energy", 1.2), ("tempo", -5), ("key", 2.5), ("loudness", None),
                         ("duration_ms", 0), ("tempo", ""), ("danceability", True)):
        patch = {field: value}
        if not modeling.validate_input({**defaults, **patch}):
            raise ValueError(f"Validation accepted {patch}")
        invalid.append({"name": f"{field} = {value!r}", "patch": patch, "field": field, "base": defaults})
    return {"tolerance": 1e-9, "valid": valid, "invalid": invalid}


class ArtifactBuild:
    """Stage every output before replacing any file and roll back failed replacements."""

    def __init__(self, directory: Path):
        self.directory = directory
        self.outputs: dict[Path, Path] = {}

    def path(self, target: Path) -> Path:
        staged = self.directory / target.relative_to(config.ROOT)
        self.outputs[target] = staged
        return staged

    def write(self, obj, target: Path, indent: int | None = None) -> int:
        return dump(obj, self.path(target), indent)

    def publish(self) -> None:
        backups = {}
        for target, staged in self.outputs.items():
            if not staged.is_file():
                raise FileNotFoundError(staged)
            if target.exists():
                backup = self.directory / "backup" / target.relative_to(config.ROOT)
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, backup)
                backups[target] = backup
        published = []
        try:
            for target, staged in self.outputs.items():
                target.parent.mkdir(parents=True, exist_ok=True)
                staged.replace(target)
                published.append(target)
        except OSError:
            for target in reversed(published):
                if target in backups:
                    backups[target].replace(target)
                else:
                    target.unlink()
            raise


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", type=Path, default=config.RAW_CSV)
    ap.add_argument("--skip-local", action="store_true", help="do not write track-level local artifacts")
    args = ap.parse_args()
    if not args.csv.exists():
        sys.exit(f"CSV not found: {args.csv}. Place the dataset at data/raw/dataset.csv or pass --csv.")

    with TemporaryDirectory(prefix=".tracklens-build-", dir=config.ROOT) as directory:
        build = ArtifactBuild(Path(directory))
        regenerate(args.csv, args.skip_local, build)
        build.publish()


def regenerate(csv: Path, skip_local: bool, build: ArtifactBuild) -> None:
    t0 = time.time()
    digest = data.sha256(csv)
    log(f"Loading {csv} (sha256 {digest[:12]})")
    raw = data.load_raw(csv)
    tracks, memberships, rules = data.canonicalise(raw)
    tracks["dup_group"] = data.assign_duplicate_groups(tracks)
    prof = data.profile(raw, tracks, memberships, rules)
    mpop = memberships.merge(tracks[["track_id", "popularity"]], on="track_id")
    prof["zero_popularity_memberships"] = int((mpop["popularity"] == 0).sum())
    dup_sizes = tracks.groupby("dup_group").size()
    prof["duplicate_recording_groups"] = int((dup_sizes > 1).sum())
    prof["tracks_in_duplicate_recording_groups"] = int(dup_sizes[dup_sizes > 1].sum())
    gsize = tracks["dup_group"].map(dup_sizes)
    gmax = tracks.groupby("dup_group")["popularity"].transform("max")
    zero = tracks["popularity"] == 0
    prof["zero_tracks_in_duplicate_groups"] = int((zero & (gsize > 1)).sum())
    prof["zero_tracks_with_nonzero_duplicate"] = int((zero & (gmax > 0)).sum())
    log(f"  {prof['rows']} rows -> {len(tracks)} canonical tracks, {len(memberships)} memberships, {prof['genres']} genres")

    genres = sorted(memberships["track_genre"].unique().tolist())
    valid = tracks[tracks["model_valid"]].reset_index(drop=True)
    sim_X = valid[config.SIMILARITY_FEATURES].to_numpy(float)
    sim_mean, sim_scale = sim_X.mean(axis=0), sim_X.std(axis=0, ddof=0)

    sources = [Path(__file__), *sorted(Path(data.__file__).parent.glob("*.py"))]
    fingerprint = hashlib.sha256()
    for value in (digest, np.__version__, pd.__version__, sklearn.__version__):
        fingerprint.update((value + "\n").encode())
    for path in sources:
        fingerprint.update(path.read_bytes())
    version = {
        "schemaVersion": config.SCHEMA_VERSION,
        "dataSha256": digest,
        "buildId": fingerprint.hexdigest(),
    }
    sizes = {}
    log("Building aggregate artifacts")
    overview = aggregates.build_overview(tracks, memberships, genres)
    sizes["overview.json"] = build.write({**overview, **version}, config.PUBLIC_DATA / "overview.json")
    genre_doc = aggregates.build_genres(tracks, memberships, genres, sim_mean, sim_scale)
    sizes["genres.json"] = build.write({**genre_doc, **version}, config.PUBLIC_DATA / "genres.json")
    sim_spec = aggregates.build_similarity_spec(sim_mean, sim_scale, len(valid))
    sizes["similarity.json"] = build.write({**sim_spec, **version}, config.PUBLIC_DATA / "similarity.json")

    log("Splitting and training")
    valid["split"] = modeling.split(valid).to_numpy()
    frames = {k: valid[valid["split"] == k].reset_index(drop=True) for k in ("train", "validation", "test")}
    crossing = valid.groupby("dup_group")["split"].nunique()
    assert int((crossing > 1).sum()) == 0, "a duplicate group crosses splits"
    name_only = valid["track_name"].map(data.normalise_text)
    train_names = set(name_only[valid["split"] == "train"]) - {""}
    test_names_in_train = int(name_only[valid["split"] == "test"].isin(train_names).sum())
    split_info = {
        "rows": {k: int(len(v)) for k, v in frames.items()},
        "groupsCrossingSplits": 0,
        "excludedInvalidTracks": int((~tracks["model_valid"]).sum()),
        "testTracksWithTitleInTrain": test_names_in_train,
        "seed": config.SEED,
        "method": "GroupShuffleSplit 70/15/15 on duplicate-recording groups",
    }
    sel = modeling.train_and_select(frames, log=log)
    evaluation = modeling.evaluate(sel["selected"], sel["best_by_family"], frames, log=log)
    evaluation["split"] = split_info
    evaluation["trials"] = [
        {"family": t["family"], "label": t["label"], "validationMae": t["validation"]["mae"], "fitSeconds": t["fitSeconds"]}
        for t in sel["trials"]
    ]
    evaluation["features"] = config.MODEL_FEATURES
    spec = modeling.export_model(sel["selected"], len(frames["train"]))
    spec["defaults"] = model_defaults(frames["train"])
    probe = frames["test"].sample(n=min(512, len(frames["test"])), random_state=config.SEED)
    evaluation["exportParity"] = {
        "heldOutRows": len(probe),
        "maxRawDifference": verify_predictions(spec, sel["selected"]["_est"], probe),
    }
    evaluation["baselineValue"] = float(sel["best_by_family"]["baseline"]["_est"].model.constant_.ravel()[0])
    sizes["model.json"] = build.write({**spec, **version}, config.PUBLIC_DATA / "model.json")
    sizes["model-eval.json"] = build.write({**evaluation, **version}, config.PUBLIC_DATA / "model-eval.json")

    log("Writing parity fixtures")
    fixtures = parity_fixtures(spec, sel["selected"]["_est"])
    build.write({**fixtures, **version}, config.WEB_FIXTURES / "parity.json", indent=1)

    meta = {
        **version,
        "title": "TrackLens",
        "profile": prof,
        "artifacts": sizes,
        "publication": {
            "mode": "aggregate",
            "reason": (
                "The CSV is a third-party compilation of data originally retrieved from Spotify. Its mirrors list "
                "conflicting licences and Spotify's developer terms restrict redistributing Spotify content, so "
                "permission to republish track-level records could not be established. The public site therefore "
                "ships only aggregates, the model parameters and synthetic test fixtures."
            ),
        },
    }
    sizes["meta.json"] = dump(meta, config.PUBLIC_DATA / "meta.json")

    if not skip_local:
        log("Writing local track-level artifacts (git-ignored)")
        t = tracks.copy()
        gidx = {g: i for i, g in enumerate(genres)}
        tg = memberships.assign(g=memberships["track_genre"].map(gidx)).groupby("track_id")["g"].apply(lambda s: sorted(int(v) for v in s))
        split_map = dict(zip(valid["track_id"], valid["split"]))
        local = {
            **version,
            "count": int(len(t)),
            "genres": genres,
            "id": t["track_id"].tolist(),
            "name": [v or "" for v in t["track_name"]],
            "artists": [v or "" for v in t["artists"]],
            "album": [v or "" for v in t["album_name"]],
            "popularity": t["popularity"].astype(int).tolist(),
            "genreIdx": [tg[i] for i in t["track_id"]],
            "dupGroup": t["dup_group"].astype(int).tolist(),
            "split": [split_map.get(i, "excluded") for i in t["track_id"]],
            "valid": t["model_valid"].astype(int).tolist(),
            "explicit": t["explicit"].astype(int).tolist(),
        }
        for f in ["duration_ms", "key", "mode", "time_signature"]:
            local[f] = t[f].astype(int).tolist()
        for f in config.UNIT_FEATURES + ["loudness", "tempo"]:
            local[f] = [float(v) for v in t[f]]
        build.write(local, config.LOCAL_DATA / "tracks.json")
        build.write({"mode": "full", **version}, config.LOCAL_DATA / "manifest.json")

    write_data_notes(prof, split_info, genre_doc, build.path(config.DOCS / "data-notes.md"))
    write_model_card(evaluation, spec, split_info, prof, build.path(config.DOCS / "model-card.md"))
    log("Artifact sizes (bytes): " + ", ".join(f"{k}={v:,}" for k, v in sizes.items()))
    log(f"Selected {evaluation['selected']}: test MAE {evaluation['test']['mae']:.3f} vs baseline {evaluation['baselineTest']['mae']:.3f}")
    log(f"Done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
