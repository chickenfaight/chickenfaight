from datetime import UTC, date, datetime

import pytest

from app.services.challenge import TWISTS, Twist, check_prompt, resets_at, twist_for


def test_same_day_same_twist_and_it_rotates():
    day = date(2026, 10, 8)
    assert twist_for(day) == twist_for(date(2026, 10, 8))
    week = {twist_for(date(2026, 10, d)) for d in range(1, 1 + len(TWISTS))}
    assert week == set(TWISTS)


def test_resets_at_next_utc_midnight():
    assert resets_at(date(2026, 10, 8)) == datetime(2026, 10, 9, tzinfo=UTC)


@pytest.mark.parametrize(("twist", "prompt", "ok"), [
    (Twist("t", "d", max_chars=10), "x" * 10, True),
    (Twist("t", "d", max_chars=10), "x" * 11, False),
    (Twist("t", "d", banned_word="because"), "Win BECAUSE logic.", False),
    (Twist("t", "d", banned_word="because"), "Becauses aren't words.", True),  # whole words only
    (Twist("t", "d", required_word="chicken"), "Talk like a Chicken.", True),
    (Twist("t", "d", required_word="chicken"), "Talk like chickens.", False),
])
def test_prompt_rules(twist, prompt, ok):
    assert (check_prompt(twist, prompt) is None) == ok
