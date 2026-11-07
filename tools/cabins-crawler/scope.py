"""Owner-approved ASI Cabins discovery geographic policy.

No country is excluded merely because of perceived cleanliness, nationality, or stereotypes.
Manual owner decisions are the sole automated exclusion source.
"""
EXCLUDED_COUNTRY_CODES = frozenset({"MM", "BD", "KP", "TL"})
EXCLUSION_REASON = {
    "MM": "Owner-excluded destination",
    "BD": "Owner-excluded destination",
    "KP": "Owner-excluded destination",
    "TL": "Owner-excluded destination",
}
MIN_POPULATION = 1_000_000  # Strictly greater than this figure, UN DEGURBA 2025.
SOURCE_YEAR = 2025
