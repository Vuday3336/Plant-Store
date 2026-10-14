"""Checks for make_actions.py.   Run:  python -m unittest test_make_actions.py"""
import csv
import os
import unittest

from make_actions import build_actions

HERE = os.path.dirname(os.path.abspath(__file__))
FIELDS = "shipment_id,order_number,shipped_on,courier,city,pincode,payment,order_value,shipping_cost,attempts,status,fail_reason,customer_contacted,closed,reship_of".split(",")


def row(**kw):
    base = {f: "" for f in FIELDS}
    base.update({"shipment_id": "S1", "order_number": "ORD-1", "shipped_on": "2026-10-01",
                 "payment": "prepaid", "attempts": "1", "status": "failed_open"})
    base.update(kw)
    return base


def actions(*rows):
    return dict(build_actions(list(rows)))


class FailedOpenRules(unittest.TestCase):
    def test_refused_wins_over_everything(self):
        r = row(fail_reason="refused", attempts="1", customer_contacted="no")
        self.assertEqual(actions(r), {"S1": "RETURN"})

    def test_three_attempts_returns_even_with_wrong_address(self):
        r = row(fail_reason="wrong_address", attempts="3")
        self.assertEqual(actions(r), {"S1": "RETURN"})

    def test_wrong_address_asks_for_address_even_if_not_contacted(self):
        r = row(fail_reason="wrong_address", attempts="2", customer_contacted="no")
        self.assertEqual(actions(r), {"S1": "ASK_ADDRESS"})

    def test_not_contacted_gets_contact(self):
        r = row(fail_reason="not_home", attempts="2", customer_contacted="no")
        self.assertEqual(actions(r), {"S1": "CONTACT"})

    def test_contacted_gets_retry(self):
        r = row(fail_reason="phone_off", attempts="1", customer_contacted="yes")
        self.assertEqual(actions(r), {"S1": "RETRY"})


class ReturnedRules(unittest.TestCase):
    def test_closed_needs_nothing(self):
        self.assertEqual(actions(row(status="returned", closed="yes")), {})

    def test_prepaid_open_asks_choice(self):
        self.assertEqual(actions(row(status="returned", closed="no")), {"S1": "ASK_CHOICE"})

    def test_cod_open_is_closed(self):
        self.assertEqual(actions(row(status="returned", closed="no", payment="cod")), {"S1": "CLOSE"})

    def test_already_sent_again_needs_nothing(self):
        first = row(status="returned", closed="no")
        second = row(shipment_id="S2", shipped_on="2026-10-05", status="delivered", reship_of="S1")
        self.assertEqual(actions(first, second), {})

    def test_a_reship_that_came_back_is_handled_on_its_own(self):
        first = row(status="returned", closed="yes")
        second = row(shipment_id="S2", shipped_on="2026-10-05", status="returned", closed="no", reship_of="S1")
        self.assertEqual(actions(first, second), {"S2": "ASK_CHOICE"})


class OtherParcels(unittest.TestCase):
    def test_delivered_and_in_transit_need_nothing(self):
        self.assertEqual(actions(row(status="delivered"), row(shipment_id="S2", status="in_transit")), {})


class RealFile(unittest.TestCase):
    """Cross-check the committed actions.csv against a plain recount of the file."""

    def test_actions_csv_matches_rules(self):
        with open(os.path.join(HERE, "shipments.csv"), newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        with open(os.path.join(HERE, "actions.csv"), newline="", encoding="utf-8") as f:
            written = list(csv.DictReader(f))

        self.assertEqual(list(written[0].keys()), ["shipment_id", "action"])
        ids = [w["shipment_id"] for w in written]
        self.assertEqual(len(ids), len(set(ids)), "one row per parcel")

        stuck = {r["shipment_id"] for r in rows if r["status"] == "failed_open"}
        open_returns = {r["shipment_id"] for r in rows if r["status"] == "returned" and r["closed"] != "yes"}
        reshipped = {r["reship_of"] for r in rows if r["reship_of"]}
        # every failed_open parcel always gets an action
        self.assertTrue(stuck <= set(ids))
        # open returns get one unless they were sent again
        self.assertEqual(set(ids) - stuck, open_returns - reshipped)


if __name__ == "__main__":
    unittest.main()
