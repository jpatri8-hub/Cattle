"""Pedigree-based inbreeding risk: Wright's Coefficient of Inbreeding (COI),
computed via the standard recursive numerator (additive) relationship
method - the provably-correct way to do path counting once a pedigree has
any compounding relatedness (e.g. two common ancestors who are themselves
related), where naively summing every sire-to-ancestor / dam-to-ancestor
path pair over-counts.

Each Animal's hidden, always-unique `id` primary key is the identifier this
walks the pedigree with - `tag_id` is just a barn label and can duplicate
across animals, so it's never used here.

The additive relationship a(x, y) between two animals is defined recursively:
    a(x, x) = 1 + F_x                        (F_x = 0.5 * a(sire_x, dam_x))
    a(x, y) = 0.5 * (a(sire_x, y) + a(dam_x, y))   for x != y, expanding
              whichever of x/y has recorded parents left in the generation
              budget (an animal with no recorded sire/dam is a foundation
              animal - the zero-parent baseline - and simply contributes 0,
              which is exactly where the recursion bottoms out)

F for a hypothetical (or actual) calf out of a given sire and dam is then
just 0.5 * a(sire, dam).
"""
from app.models import Animal

MAX_GENERATIONS = 6


def _additive_relationship(x_id, y_id, budget, memo, animal_cache):
    if not x_id or not y_id or budget < 0:
        return 0.0
    key = (x_id, y_id, budget) if x_id <= y_id else (y_id, x_id, budget)
    if key in memo:
        return memo[key]

    def get(animal_id):
        if animal_id not in animal_cache:
            animal_cache[animal_id] = Animal.query.get(animal_id)
        return animal_cache[animal_id]

    if x_id == y_id:
        animal = get(x_id)
        if budget <= 0 or not animal or not animal.sire_id or not animal.dam_id:
            result = 1.0  # founder (or generation budget exhausted): F defaults to 0
        else:
            result = 1.0 + 0.5 * _additive_relationship(
                animal.sire_id, animal.dam_id, budget - 1, memo, animal_cache
            )
    else:
        # The tabular method requires always expanding the younger of the two
        # (never an ancestor already reached by the other side) - otherwise a
        # common ancestor that's itself related to the other side gets
        # expanded past, over- or under-counting its contribution. A row's id
        # can only be inserted after both its sire_id/dam_id rows exist, so
        # "larger id" is a reliable stand-in for "younger" here.
        newer_id, older_id = (x_id, y_id) if x_id > y_id else (y_id, x_id)
        newer = get(newer_id)
        if budget > 0 and newer and newer.sire_id and newer.dam_id:
            result = 0.5 * (
                _additive_relationship(newer.sire_id, older_id, budget - 1, memo, animal_cache)
                + _additive_relationship(newer.dam_id, older_id, budget - 1, memo, animal_cache)
            )
        else:
            older = get(older_id)
            if budget > 0 and older and older.sire_id and older.dam_id:
                result = 0.5 * (
                    _additive_relationship(newer_id, older.sire_id, budget - 1, memo, animal_cache)
                    + _additive_relationship(newer_id, older.dam_id, budget - 1, memo, animal_cache)
                )
            else:
                result = 0.0  # neither side has recorded parents left to explore - unrelated as far as we know

    memo[key] = result
    return result


def coefficient_of_inbreeding(sire_id, dam_id, max_generations=MAX_GENERATIONS):
    """Wright's COI for a hypothetical (or actual) calf out of the given sire
    and dam, as a fraction (0.25 = 25%). Returns 0.0 if either parent is
    unknown, or if sire_id == dam_id (not a real mating)."""
    if not sire_id or not dam_id or sire_id == dam_id:
        return 0.0
    memo = {}
    animal_cache = {}
    return 0.5 * _additive_relationship(sire_id, dam_id, max_generations, memo, animal_cache)


def coefficient_of_inbreeding_pct(sire_id, dam_id, max_generations=MAX_GENERATIONS):
    return round(coefficient_of_inbreeding(sire_id, dam_id, max_generations) * 100, 2)
