import pytest

from app.services.bilc_rules import class_distance, is_outdated, parameter_count, size_class


def model(parameter_size):
    return {"name": "m", "context_length": None, "metadata": {"parameter_size": parameter_size}}


@pytest.mark.parametrize(("reported", "count"), [
    ("8.0B", 8e9), ("3.2B", 3.2e9), ("567M", 567e6), ("70.6B", 70.6e9), ("1T", 1e12), (" 7b ", 7e9),
])
def test_parameter_count_reads_ollama_sizes(reported, count):
    assert parameter_count(model(reported)) == pytest.approx(count)


@pytest.mark.parametrize("reported", [None, "", "eight", "8", "8.0GB", 8, ["8B"]])
def test_unreadable_sizes_are_unknown(reported):
    assert parameter_count(model(reported)) is None


def test_missing_metadata_is_unknown():
    assert parameter_count({"name": "m"}) is None
    assert parameter_count({"name": "m", "metadata": "8B"}) is None
    assert parameter_count(None) is None


@pytest.mark.parametrize(("reported", "expected"), [
    ("1.2B", "small"), ("7.9B", "small"),
    ("8.0B", "medium"), ("14B", "medium"), ("30B", "medium"),
    ("30.1B", "large"), ("70B", "large"),
    (None, "large"),  # unknown counts as large
])
def test_size_class_boundaries(reported, expected):
    assert size_class(model(reported)) == expected


def test_class_distance():
    assert class_distance("small", "small") == 0
    assert class_distance("small", "medium") == 1
    assert class_distance("large", "medium") == 1
    assert class_distance("small", "large") == 2


@pytest.mark.parametrize(("client", "outdated"), [
    ("0.1.0", False), ("0.2.3", False), ("v1.0.0", False), ("0.1.0-rc.1", False),
    ("0.0.9", True), ("0.0.0-SNAPSHOT-abc", True), ("garbage", True), ("dev", True),
])
def test_version_check(client, outdated):
    assert is_outdated(client, "0.1.0", allow_dev=False) is outdated


def test_dev_builds_pass_only_in_development():
    assert is_outdated("dev", "0.1.0", allow_dev=True) is False
    assert is_outdated("development", "0.1.0", allow_dev=True) is True


def test_bad_minimum_is_a_configuration_error():
    with pytest.raises(ValueError):
        is_outdated("1.0.0", "latest", allow_dev=False)
