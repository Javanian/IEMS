
import sys

from sap_staging_common import (
    expand_legacy_into_type_maps,
    legacy_category_minutes,
    normalize_max_record_minutes,
)

FAIL = []


def eq(label, got, want):
    if got != want:
        FAIL.append((label, got, want))
        print(f"FAIL {label}\n  got  {got}\n  want {want}")
    else:
        print(f"ok   {label}")


CATALOG = {
    "mch": [
        {"statusid": 1, "category": "va"},
        {"statusid": 2, "category": "nva"},
        {"statusid": 7, "category": "nnva"},
        {"statusid": 12, "category": "nva"},
    ],
    "timesheet": [
        {"activitytype": "", "category": "va"},
        {"activitytype": "1520", "category": "nva"},
        {"activitytype": "1670", "category": "nva"},
    ],
}

eq("legacy number", legacy_category_minutes(150), {"va": 150, "nnva": 150, "nva": 150})
eq("legacy object", legacy_category_minutes({"va": 300, "nnva": 150, "nva": 150}), {"va": 300, "nnva": 150, "nva": 150})
eq("new no legacy", legacy_category_minutes({"mch": {"1": 300}, "timesheet": {"": 300}}), None)
eq(
    "normalize per-type",
    normalize_max_record_minutes({"mch": {"1": 300, "2": None, "x": 5}, "timesheet": {"": 480, "1520": 30, "xx": 9}}),
    {"mch": {"1": 300, "2": None}, "timesheet": {"": 480, "1520": 30}},
)
expanded = expand_legacy_into_type_maps(
    normalize_max_record_minutes({"mch": {"1": None}, "timesheet": {}}),
    {"va": 300, "nnva": 150, "nva": 150},
    CATALOG,
)
eq(
    "expand legacy",
    expanded,
    {"mch": {"1": None, "2": 150, "7": 150, "12": 150}, "timesheet": {"": 300, "1520": 150, "1670": 150}},
)
eq("expand idempotent", expand_legacy_into_type_maps(expanded, {"va": 300, "nnva": 150, "nva": 150}, CATALOG), expanded)

print("\n6/6 PASS" if not FAIL else f"\n{len(FAIL)} FAIL")
sys.exit(1 if FAIL else 0)
