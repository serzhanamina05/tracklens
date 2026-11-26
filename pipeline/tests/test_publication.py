"""The published folder must never contain track-level records."""
import json
import re

import pytest

from tracklens import config

ID_RE = re.compile(r"\b[0-9A-Za-z]{22}\b")
MAX_STRING_LIST = 200  # genre list has 114 entries; a track-level text column would have ~90k


def string_lists(obj):
    if isinstance(obj, dict):
        for v in obj.values():
            yield from string_lists(v)
    elif isinstance(obj, list):
        if obj and all(isinstance(v, str) for v in obj):
            yield obj
        for v in obj:
            yield from string_lists(v)


def public_files():
    return sorted(config.PUBLIC_DATA.glob("*.json")) + [config.WEB_FIXTURES / "parity.json"]


@pytest.mark.parametrize("path", public_files(), ids=lambda p: p.name)
def test_no_identifiers_in_public_artifacts(path):
    if not path.exists():
        pytest.skip("not built")
    text = path.read_text()
    doc = json.loads(text)
    assert all(len(lst) <= MAX_STRING_LIST for lst in string_lists(doc)), path.name
    stripped = text.replace(doc.get("dataSha256", ""), "").replace(doc.get("buildId", ""), "")
    assert not ID_RE.search(stripped), f"{path.name} contains an ID-like token"


def test_no_real_track_ids_leak():
    local = config.LOCAL_DATA / "tracks.json"
    if not local.exists():
        pytest.skip("local full data not built")
    ids = set(json.loads(local.read_text())["id"])
    for path in public_files():
        tokens = set(ID_RE.findall(path.read_text()))
        assert not tokens & ids, path.name


def test_public_artifacts_belong_to_one_build():
    names = ("meta", "overview", "genres", "similarity", "model", "model-eval")
    expected = None
    for name in names:
        source = config.PUBLIC_DATA / f"{name}.json"
        doc = json.loads(source.read_text())
        identity = (doc["schemaVersion"], doc["dataSha256"], doc["buildId"])
        assert identity[0] == config.SCHEMA_VERSION
        assert re.fullmatch(r"[a-f0-9]{64}", identity[1])
        assert re.fullmatch(r"[a-f0-9]{64}", identity[2])
        if expected is None:
            expected = identity
        assert identity == expected, source
