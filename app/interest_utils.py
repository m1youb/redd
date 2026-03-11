from __future__ import annotations


def normalize_interest_list(raw_interests: str | list[str] | tuple[str, ...] | None) -> list[str]:
    if isinstance(raw_interests, str):
        candidates = raw_interests.split(",")
    elif isinstance(raw_interests, (list, tuple)):
        candidates = list(raw_interests)
    else:
        candidates = []

    normalized: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        value = str(item or "").strip()
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(value)
    return normalized


def normalize_interest_csv(raw_interests: str | list[str] | tuple[str, ...] | None) -> str:
    return ", ".join(normalize_interest_list(raw_interests))


def rotate_interest_queue(raw_interests: str | list[str] | tuple[str, ...] | None) -> tuple[str, list[str], str | None]:
    interests = normalize_interest_list(raw_interests)
    if not interests:
        return "", [], None
    if len(interests) == 1:
        return interests[0], interests, interests[0]

    used_interest = interests.pop(0)
    interests.append(used_interest)
    return ", ".join(interests), interests, used_interest


def move_interest_to_back(
    raw_interests: str | list[str] | tuple[str, ...] | None,
    used_interest: str | None,
) -> tuple[str, list[str], str | None]:
    interests = normalize_interest_list(raw_interests)
    target = str(used_interest or "").strip()
    if not interests:
        return "", [], None
    if not target:
        return ", ".join(interests), interests, None

    target_key = target.lower()
    match_index = next((index for index, value in enumerate(interests) if value.lower() == target_key), None)
    if match_index is None:
        return ", ".join(interests), interests, None
    if len(interests) == 1:
        return interests[0], interests, interests[0]

    matched_interest = interests.pop(match_index)
    interests.append(matched_interest)
    return ", ".join(interests), interests, matched_interest
