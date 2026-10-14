"""Write the morning action list for stuck parcels.

    python make_actions.py                      reads shipments.csv, writes actions.csv
    python make_actions.py in.csv out.csv       other files

Rules are the ones in README.md ("What the team does with a parcel").
Only the standard library is used, so it runs anywhere Python 3.8+ is.
"""
import csv
import sys

RETURN = "RETURN"
ASK_ADDRESS = "ASK_ADDRESS"
CONTACT = "CONTACT"
RETRY = "RETRY"
ASK_CHOICE = "ASK_CHOICE"
CLOSE = "CLOSE"


def clean(value):
    return (value or "").strip().lower()


def to_int(value):
    try:
        return int(float(clean(value) or 0))
    except ValueError:
        return 0


def sent_again_ids(rows):
    """Shipment ids whose order has already been sent again.

    The file links a second try with reship_of. As a fallback a later parcel
    for the same order also counts, in case someone forgets to fill reship_of.
    """
    ids = set()
    for row in rows:
        if clean(row["reship_of"]):
            ids.add(row["reship_of"].strip())

    by_order = {}
    for row in rows:
        by_order.setdefault(row["order_number"].strip(), []).append(row)
    for parcels in by_order.values():
        if len(parcels) < 2:
            continue
        for row in parcels:
            later = [p for p in parcels if p is not row and p["shipped_on"] > row["shipped_on"]]
            if later:
                ids.add(row["shipment_id"].strip())
    return ids


def action_for(row, sent_again):
    status = clean(row["status"])

    if status == "failed_open":
        reason = clean(row["fail_reason"])
        if reason == "refused":
            return RETURN
        if to_int(row["attempts"]) >= 3:
            return RETURN
        if reason == "wrong_address":
            return ASK_ADDRESS
        if clean(row["customer_contacted"]) != "yes":
            return CONTACT
        return RETRY

    if status == "returned" and clean(row["closed"]) != "yes":
        if row["shipment_id"].strip() in sent_again:
            return None
        if clean(row["payment"]) == "prepaid":
            return ASK_CHOICE
        if clean(row["payment"]) == "cod":
            return CLOSE
        # A payment type we do not know: a person should look, so do not guess.
        raise ValueError("unknown payment %r on %s" % (row["payment"], row["shipment_id"]))

    return None


def build_actions(rows):
    sent_again = sent_again_ids(rows)
    out = []
    for row in rows:
        action = action_for(row, sent_again)
        if action:
            out.append((row["shipment_id"].strip(), action))
    return out


def main(argv):
    src = argv[1] if len(argv) > 1 else "shipments.csv"
    dst = argv[2] if len(argv) > 2 else "actions.csv"
    with open(src, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    actions = build_actions(rows)
    with open(dst, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(["shipment_id", "action"])
        writer.writerows(actions)
    counts = {}
    for _, action in actions:
        counts[action] = counts.get(action, 0) + 1
    print("wrote %d rows to %s %s" % (len(actions), dst, dict(sorted(counts.items()))))


if __name__ == "__main__":
    main(sys.argv)
