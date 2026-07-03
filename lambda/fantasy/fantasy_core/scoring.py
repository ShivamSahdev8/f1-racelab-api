from fantasy_core.models import RaceResult, ScoreBreakdown

# A module-level constant. UPPER_CASE names signal "this is a constant, don't mutate it."
# A dict is Python's lookup table: position → points.
POSITION_POINTS = {
    1: 25, 2: 18, 3: 15, 4: 12, 5: 10,
    6: 8,  7: 6,  8: 4,  9: 2,  10: 1,
}

def position_points(finish: int) -> int:
    """Points for finishing position. P11+ scores 0."""
    # dict.get(key, default) is the star of this function:
    # if `finish` isn't a key (e.g. 15), it returns 0 instead of crashing.
    return POSITION_POINTS.get(finish, 0)