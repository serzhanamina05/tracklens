"""Popularity regression: split, train, select, evaluate, export.

The exported JSON is the single source of truth for browser predictions. The
pure-Python ``predict_exported`` below evaluates that JSON exactly the way the
TypeScript implementation does, and the parity tests compare both against the
fitted scikit-learn estimator.
"""

from __future__ import annotations

import math
from numbers import Real
import time
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupShuffleSplit

from . import config

RIDGE_NUMERIC = [f for f in config.MODEL_FEATURES if f not in ("key", "time_signature")]
RIDGE_CATEGORICAL = ["key", "time_signature"]


# --------------------------------------------------------------------------- #
# Validation and clipping (mirrored in web/src/lib/model.ts)
# --------------------------------------------------------------------------- #
def validate_input(values: dict) -> list[str]:
    """Return a list of human-readable problems; empty means valid."""
    problems = []
    for f in config.MODEL_FEATURES:
        rule = config.VALIDATION[f]
        v = values.get(f)
        if v is None:
            problems.append(f"{f}: missing")
            continue
        if isinstance(v, (bool, np.bool_)) or not isinstance(v, Real):
            problems.append(f"{f}: not a number")
            continue
        x = float(v)
        if not math.isfinite(x):
            problems.append(f"{f}: not a finite number")
        elif x < rule["min"] or x > rule["max"]:
            problems.append(f"{f}: outside {rule['min']}-{rule['max']}")
        elif rule["integer"] and x != round(x):
            problems.append(f"{f}: must be a whole number")
    return problems


def clip(pred: np.ndarray) -> np.ndarray:
    return np.clip(pred, *config.OUTPUT_CLIP)


def matrix(frame: pd.DataFrame) -> np.ndarray:
    return frame[config.MODEL_FEATURES].astype(float).to_numpy()


# --------------------------------------------------------------------------- #
# Split
# --------------------------------------------------------------------------- #
def split(model_rows: pd.DataFrame) -> pd.Series:
    """70/15/15 split by duplicate-recording group, fixed seed."""
    groups = model_rows["dup_group"].to_numpy()
    idx = np.arange(len(model_rows))
    outer = GroupShuffleSplit(n_splits=1, test_size=0.15, random_state=config.SEED)
    trval, test = next(outer.split(idx, groups=groups))
    inner = GroupShuffleSplit(n_splits=1, test_size=0.15 / 0.85, random_state=config.SEED)
    tr_rel, va_rel = next(inner.split(trval, groups=groups[trval]))
    labels = np.empty(len(model_rows), dtype=object)
    labels[trval[tr_rel]] = "train"
    labels[trval[va_rel]] = "validation"
    labels[test] = "test"
    return pd.Series(labels, index=model_rows.index, name="split")


# --------------------------------------------------------------------------- #
# Ridge with explicit, exportable preprocessing (fit on training rows only)
# --------------------------------------------------------------------------- #
@dataclass
class RidgePrep:
    means: np.ndarray
    scales: np.ndarray
    levels: dict = field(default_factory=dict)

    @classmethod
    def fit(cls, X: pd.DataFrame) -> "RidgePrep":
        num = X[RIDGE_NUMERIC].astype(float)
        scales = num.std(ddof=0).to_numpy().copy()
        scales[scales == 0] = 1.0
        levels = {c: sorted(int(v) for v in X[c].unique()) for c in RIDGE_CATEGORICAL}
        return cls(num.mean().to_numpy().copy(), scales, levels)

    def transform(self, X: pd.DataFrame) -> np.ndarray:
        num = (X[RIDGE_NUMERIC].astype(float).to_numpy() - self.means) / self.scales
        cats = []
        for c in RIDGE_CATEGORICAL:
            col = X[c].astype(int).to_numpy()
            # Unknown levels map to all zeros (the training-mean effect).
            cats.append(np.stack([(col == lv).astype(float) for lv in self.levels[c]], axis=1))
        return np.hstack([num] + cats)


class RidgeModel:
    def __init__(self, alpha: float):
        self.alpha = alpha
        self.prep: RidgePrep | None = None
        self.model = Ridge(alpha=alpha)

    def fit(self, X: pd.DataFrame, y: np.ndarray) -> "RidgeModel":
        self.prep = RidgePrep.fit(X)
        self.model.fit(self.prep.transform(X), y)
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return self.model.predict(self.prep.transform(X))


class FrameHGB:
    """HistGradientBoostingRegressor on the raw model features (no scaling needed)."""

    def __init__(self, **params):
        self.params = params
        self.model = HistGradientBoostingRegressor(random_state=config.SEED, early_stopping=False, **params)

    def fit(self, X: pd.DataFrame, y: np.ndarray) -> "FrameHGB":
        self.model.fit(matrix(X), y)
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return self.model.predict(matrix(X))


class FrameDummy:
    def __init__(self):
        self.model = DummyRegressor(strategy="median")

    def fit(self, X: pd.DataFrame, y: np.ndarray) -> "FrameDummy":
        self.model.fit(matrix(X), y)
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return self.model.predict(matrix(X))


def metrics(y: np.ndarray, pred: np.ndarray) -> dict:
    p = clip(pred)
    return {
        "mae": float(mean_absolute_error(y, p)),
        "rmse": float(math.sqrt(mean_squared_error(y, p))),
        "r2": float(r2_score(y, p)),
    }


# --------------------------------------------------------------------------- #
# Training and selection
# --------------------------------------------------------------------------- #
HGB_GRID = [
    {"loss": loss, "learning_rate": lr, "max_leaf_nodes": leaves, "max_iter": 250, "min_samples_leaf": 40, "l2_regularization": 1.0}
    for loss in ("squared_error", "absolute_error")
    for lr in (0.05, 0.1)
    for leaves in (15, 31)
]
RIDGE_GRID = [0.1, 1.0, 10.0, 100.0, 1000.0]


def train_and_select(frames: dict[str, pd.DataFrame], log=print) -> dict:
    tr, va = frames["train"], frames["validation"]
    ytr, yva = tr["popularity"].to_numpy(float), va["popularity"].to_numpy(float)
    trials = []

    def run(family: str, label: str, params: dict, factory):
        t0 = time.time()
        est = factory().fit(tr, ytr)
        m = metrics(yva, est.predict(va))
        trials.append({"family": family, "label": label, "params": params, "validation": m, "fitSeconds": round(time.time() - t0, 2), "_est": est})
        log(f"  {family:<8} {label:<60} val MAE {m['mae']:.3f}")

    run("baseline", "DummyRegressor(strategy='median')", {"strategy": "median"}, FrameDummy)
    for a in RIDGE_GRID:
        run("ridge", f"Ridge(alpha={a})", {"alpha": a}, lambda a=a: RidgeModel(a))
    for p in HGB_GRID:
        label = f"HGB(loss={p['loss']}, lr={p['learning_rate']}, leaves={p['max_leaf_nodes']})"
        run("hgb", label, p, lambda p=p: FrameHGB(**p))

    best_by_family = {}
    for t in trials:
        cur = best_by_family.get(t["family"])
        if cur is None or t["validation"]["mae"] < cur["validation"]["mae"]:
            best_by_family[t["family"]] = t
    selected = min(best_by_family.values(), key=lambda t: t["validation"]["mae"])
    return {"trials": trials, "best_by_family": best_by_family, "selected": selected}


# --------------------------------------------------------------------------- #
# Export + pure-Python evaluator of the exported JSON
# --------------------------------------------------------------------------- #
def export_model(trial: dict, train_rows: int) -> dict:
    est = trial["_est"]
    base = {
        "schemaVersion": config.SCHEMA_VERSION,
        "family": trial["family"],
        "label": trial["label"],
        "params": trial["params"],
        "features": config.MODEL_FEATURES,
        "validation": config.VALIDATION,
        "clip": list(config.OUTPUT_CLIP),
        "trainedOnRows": train_rows,
        "target": "popularity (0-100 snapshot score in the CSV)",
    }
    if isinstance(est, FrameDummy):
        return {**base, "kind": "constant", "value": float(est.model.constant_.ravel()[0])}
    if isinstance(est, RidgeModel):
        coef = est.model.coef_
        n_num = len(RIDGE_NUMERIC)
        numeric = [
            {"feature": f, "mean": float(est.prep.means[i]), "scale": float(est.prep.scales[i]), "coef": float(coef[i])}
            for i, f in enumerate(RIDGE_NUMERIC)
        ]
        categorical, off = [], n_num
        for c in RIDGE_CATEGORICAL:
            lv = est.prep.levels[c]
            categorical.append({"feature": c, "levels": lv, "coefs": [float(v) for v in coef[off : off + len(lv)]]})
            off += len(lv)
        return {**base, "kind": "linear", "intercept": float(est.model.intercept_), "numeric": numeric, "categorical": categorical}
    if isinstance(est, FrameHGB):
        m = est.model
        if m.n_trees_per_iteration_ != 1:
            raise ValueError("expected a single-output regressor")
        trees = []
        for (pred,) in m._predictors:  # noqa: SLF001 - pinned scikit-learn version, guarded by parity tests
            nodes = pred.nodes
            if nodes["is_categorical"].any():
                raise ValueError("categorical splits are not exported")
            leaf = nodes["is_leaf"].astype(bool)
            trees.append(
                {
                    "f": [int(v) if not lf else -1 for v, lf in zip(nodes["feature_idx"], leaf)],
                    "t": [float(v) if not lf else 0 for v, lf in zip(nodes["num_threshold"], leaf)],
                    "l": [int(v) if not lf else 0 for v, lf in zip(nodes["left"], leaf)],
                    "r": [int(v) if not lf else 0 for v, lf in zip(nodes["right"], leaf)],
                    "v": [float(v) if lf else 0 for v, lf in zip(nodes["value"], leaf)],
                }
            )
        return {**base, "kind": "trees", "baseline": float(np.ravel(m._baseline_prediction)[0]), "trees": trees}  # noqa: SLF001
    raise TypeError(type(est))


def predict_exported_raw(spec: dict, x: list[float]) -> float:
    """Unclipped prediction for one feature vector in spec['features'] order."""
    kind = spec["kind"]
    if kind == "constant":
        return spec["value"]
    if kind == "linear":
        pos = {f: i for i, f in enumerate(spec["features"])}
        out = spec["intercept"]
        for n in spec["numeric"]:
            out += (x[pos[n["feature"]]] - n["mean"]) / n["scale"] * n["coef"]
        for c in spec["categorical"]:
            v = int(x[pos[c["feature"]]])
            if v in c["levels"]:
                out += c["coefs"][c["levels"].index(v)]
        return out
    if kind == "trees":
        out = spec["baseline"]
        for t in spec["trees"]:
            i = 0
            while t["f"][i] != -1:
                i = t["l"][i] if x[t["f"][i]] <= t["t"][i] else t["r"][i]
            out += t["v"][i]
        return out
    raise ValueError(kind)


def predict_exported(spec: dict, x: list[float]) -> float:
    lo, hi = spec["clip"]
    return min(hi, max(lo, predict_exported_raw(spec, x)))


# --------------------------------------------------------------------------- #
# Evaluation artifacts (test set only)
# --------------------------------------------------------------------------- #
def band_label(lo: int, hi: int) -> str:
    return str(lo) if lo == hi else f"{lo}-{hi}"


def actual_bin(p: np.ndarray) -> np.ndarray:
    # 0 gets its own bin; then 1-5, 6-10, ... 96-100 -> 21 bins.
    return np.where(p == 0, 0, (p - 1) // 5 + 1).astype(int)


def bootstrap_mae_gain(y, prediction, baseline, groups) -> dict:
    """Paired group bootstrap, weighted by the number of tracks drawn."""
    _, labels = np.unique(groups, return_inverse=True)
    improvement = np.abs(y - baseline) - np.abs(y - prediction)
    totals = np.bincount(labels, weights=improvement)
    counts = np.bincount(labels)
    rng = np.random.default_rng(config.SEED)
    estimates = np.empty(1000)
    for index in range(len(estimates)):
        draw = rng.integers(len(counts), size=len(counts))
        estimates[index] = totals[draw].sum() / counts[draw].sum()
    low, high = np.quantile(estimates, [0.025, 0.975])
    return {
        "points": float(improvement.mean()),
        "interval95": [float(low), float(high)],
        "replicates": len(estimates),
        "groups": len(counts),
    }


def evaluate(selected: dict, best_by_family: dict, frames: dict, log=print) -> dict:
    te = frames["test"]
    y = te["popularity"].to_numpy(float)
    est = selected["_est"]
    pred = clip(est.predict(te))
    base_pred = clip(best_by_family["baseline"]["_est"].predict(te))

    comparison = []
    for fam in ("baseline", "ridge", "hgb"):
        t = best_by_family[fam]
        comparison.append(
            {
                "family": fam,
                "label": t["label"],
                "validation": t["validation"],
                "test": metrics(y, t["_est"].predict(te)),
                "selected": t is selected,
            }
        )

    abins = actual_bin(y.astype(int))
    pbins = np.minimum((pred // 2).astype(int), 49)
    grid = np.zeros((21, 50), dtype=int)
    np.add.at(grid, (abins, pbins), 1)

    resid = y - pred
    edges = np.arange(-100, 102, 2)
    rh, _ = np.histogram(resid, bins=edges)

    bands = []
    for lo, hi in config.POPULARITY_BANDS:
        mask = (y >= lo) & (y <= hi)
        n = int(mask.sum())
        bands.append(
            {
                "band": band_label(lo, hi),
                "n": n,
                "mae": float(np.abs(resid[mask]).mean()) if n else None,
                "baselineMae": float(np.abs(y[mask] - base_pred[mask]).mean()) if n else None,
                "meanActual": float(y[mask].mean()) if n else None,
                "meanPredicted": float(pred[mask].mean()) if n else None,
                "signedError": float(-resid[mask].mean()) if n else None,
            }
        )

    log("  permutation importance on the test set ...")
    X = matrix(te)

    class _Wrapped:
        def fit(self, *a, **k):
            return self

        def predict(self, Xm):
            return clip(est.predict(pd.DataFrame(Xm, columns=config.MODEL_FEATURES)))

    def neg_mae(e, Xm, yy):
        return -mean_absolute_error(yy, e.predict(Xm))

    imp = permutation_importance(_Wrapped(), X, y, scoring=neg_mae, n_repeats=5, random_state=config.SEED)
    importance = sorted(
        [
            {"feature": f, "maeIncrease": float(imp.importances_mean[i]), "std": float(imp.importances_std[i])}
            for i, f in enumerate(config.MODEL_FEATURES)
        ],
        key=lambda r: -r["maeIncrease"],
    )

    nonzero = y > 0
    return {
        "maeGain": bootstrap_mae_gain(y, pred, base_pred, te["dup_group"]),
        "nonzero": {
            "n": int(nonzero.sum()),
            "mae": float(np.abs(resid[nonzero]).mean()) if nonzero.any() else None,
            "baselineMae": float(np.abs(y[nonzero] - base_pred[nonzero]).mean()) if nonzero.any() else None,
        },
        "schemaVersion": config.SCHEMA_VERSION,
        "selected": selected["label"],
        "selectionRule": "lowest validation MAE (predictions clipped to 0-100) across the best configuration of each family",
        "test": metrics(y, pred),
        "baselineTest": metrics(y, base_pred),
        "comparison": comparison,
        "testRows": int(len(te)),
        "actualVsPredicted": {
            "actualBins": ["0"] + [f"{1 + 5 * i}-{5 + 5 * i}" for i in range(20)],
            "predictedBinWidth": 2,
            "counts": grid.tolist(),
        },
        "residuals": {"edges": edges.tolist(), "counts": rh.tolist(), "mean": float(resid.mean()), "median": float(np.median(resid))},
        "bands": bands,
        "importance": {"method": "permutation importance on the held-out test set, 5 repeats, MAE increase when a feature is shuffled", "rows": importance},
    }
