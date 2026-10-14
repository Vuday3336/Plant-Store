"""Where the returned-parcel money goes.   Run:  python analysis.py

Prints the numbers behind the three changes in ANSWERS.md (section 12).
Cost of a returned parcel (README): 2 x shipping_cost + 40% of order_value.
"""
import csv
import os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
NORTH_EAST = {"Guwahati", "Agartala", "Imphal"}
MISSED = {"not_home", "wrong_address", "phone_off"}  # failures a phone call can fix


def load():
    with open(os.path.join(HERE, "shipments.csv"), newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def cost(r):
    return 2 * float(r["shipping_cost"]) + 0.4 * float(r["order_value"])


def returned(rs):
    return [r for r in rs if r["status"] == "returned"]


def money(x):
    return "Rs {:,.0f}".format(x)


def table(rows, key, title):
    groups = defaultdict(list)
    for r in rows:
        groups[key(r)].append(r)
    print("\n" + title)
    print("  {:<28} {:>6} {:>8} {:>7} {:>11}".format("", "parcels", "returned", "rate", "cost"))
    for k, rs in sorted(groups.items(), key=lambda kv: -sum(cost(r) for r in returned(kv[1]))):
        ret = returned(rs)
        print("  {:<28} {:>6} {:>8} {:>6.1%} {:>11}".format(str(k), len(rs), len(ret), len(ret) / len(rs), money(sum(map(cost, ret)))))


def main():
    rows = load()
    ret = returned(rows)
    total = sum(map(cost, ret))
    print("Parcels: %d   returned: %d   cost of returns in 60 days: %s   average per return: %s"
          % (len(rows), len(ret), money(total), money(total / len(ret))))

    table(rows, lambda r: r["fail_reason"] or "(no failure)", "By reason of the last failed attempt")
    table(rows, lambda r: r["payment"], "By payment")
    table(rows, lambda r: (r["payment"], r["fail_reason"] or "-"), "Payment x reason")
    table([r for r in rows if r["fail_reason"]], lambda r: (r["fail_reason"], "contacted=" + r["customer_contacted"]),
          "Failed at least once: was the customer contacted?")
    table(rows, lambda r: r["courier"], "By courier")
    table([r for r in rows if r["city"] in NORTH_EAST], lambda r: r["courier"], "North-east (Guwahati, Agartala, Imphal) by courier")
    table([r for r in rows if r["city"] not in NORTH_EAST], lambda r: r["courier"], "Rest of India by courier")
    table([r for r in rows if r["fail_reason"] == "wrong_address"], lambda r: (r["courier"], "NE" if r["city"] in NORTH_EAST else "rest"),
          "Wrong address failures by courier and region")

    print("\n================ The three changes ================")

    # ---- 3. QuickDrop in the north-east (worked out first so change 1 does not count the same parcels twice)
    ne = [r for r in rows if r["city"] in NORTH_EAST]
    qd_ne = [r for r in ne if r["courier"] == "QuickDrop"]
    other_ne = [r for r in ne if r["courier"] != "QuickDrop"]
    qd_ret = returned(qd_ne)
    other_rate = len(returned(other_ne)) / len(other_ne)
    qd_avg = sum(map(cost, qd_ret)) / len(qd_ret)
    expected = len(qd_ne) * other_rate
    save_c = (len(qd_ret) - expected) * qd_avg
    print("\n3. Stop using QuickDrop for the north-east")
    print("   QuickDrop NE: %d parcels, %d returned (%.1f%%), cost %s; %d of them wrong_address"
          % (len(qd_ne), len(qd_ret), 100 * len(qd_ret) / len(qd_ne), money(sum(map(cost, qd_ret))),
             sum(r["fail_reason"] == "wrong_address" for r in qd_ret)))
    print("   BlueLine+PostPlus NE: %d parcels, %d returned (%.1f%%)" % (len(other_ne), len(returned(other_ne)), 100 * other_rate))
    print("   Same %d parcels at %.1f%% -> %.1f returns instead of %d. Saves %.1f x %s = %s"
          % (len(qd_ne), 100 * other_rate, expected, len(qd_ret), len(qd_ret) - expected, money(qd_avg), money(save_c)))

    # ---- 1. Call the customer after the first missed delivery
    pool = [r for r in rows if r["fail_reason"] in MISSED and r["status"] in ("delivered", "returned") and r not in qd_ne]
    yes = [r for r in pool if r["customer_contacted"] == "yes"]
    no = [r for r in pool if r["customer_contacted"] != "yes"]
    rate_yes = len(returned(yes)) / len(yes)
    rate_no = len(returned(no)) / len(no)
    no_ret = returned(no)
    no_avg = sum(map(cost, no_ret)) / len(no_ret)
    expected_no = len(no) * rate_yes
    save_a = (len(no_ret) - expected_no) * no_avg
    print("\n1. Call every customer after the first missed delivery (not_home, wrong_address, phone_off)")
    print("   Finished parcels with one of those failures (QuickDrop NE left out, it is in change 3):")
    print("   contacted:     %3d parcels, %3d returned (%.1f%%)" % (len(yes), len(returned(yes)), 100 * rate_yes))
    print("   not contacted: %3d parcels, %3d returned (%.1f%%), cost %s" % (len(no), len(no_ret), 100 * rate_no, money(sum(map(cost, no_ret)))))
    print("   If the not-contacted ones came back at the contacted rate: %.1f returns instead of %d."
          % (expected_no, len(no_ret)))
    print("   Saves %.1f x %s = %s" % (len(no_ret) - expected_no, money(no_avg), money(save_a)))
    print("   Half of that, if calling is only half as good as the data suggests: %s" % money(save_a / 2))

    # ---- 2. COD refusals
    cod = [r for r in rows if r["payment"] == "cod"]
    pre = [r for r in rows if r["payment"] == "prepaid"]
    cod_ref = [r for r in cod if r["fail_reason"] == "refused"]
    pre_ref = [r for r in pre if r["fail_reason"] == "refused"]
    cod_ref_ret = returned(cod_ref)
    cod_ref_cost = sum(map(cost, cod_ref_ret))
    pre_rate = len(pre_ref) / len(pre)
    at_prepaid_rate = len(cod) * pre_rate * (cod_ref_cost / len(cod_ref_ret))
    upper = cod_ref_cost - at_prepaid_rate
    print("\n2. Confirm cash-on-delivery orders before they ship")
    print("   COD: %d parcels, %d refused (%.1f%%), %d came back, cost %s"
          % (len(cod), len(cod_ref), 100 * len(cod_ref) / len(cod), len(cod_ref_ret), money(cod_ref_cost)))
    print("   Prepaid: %d parcels, %d refused (%.2f%%)" % (len(pre), len(pre_ref), 100 * pre_rate))
    others_cod = len(returned(cod)) - len(cod_ref_ret)
    others_pre = len(returned(pre)) - len(returned(pre_ref))
    print("   Without refusals COD and prepaid come back at the same rate: %.1f%% vs %.1f%%"
          % (100 * others_cod / len(cod), 100 * others_pre / len(pre)))
    print("   If COD refused as rarely as prepaid: saves %s (upper bound)" % money(upper))
    print("   Planning number, half of the refusals stopped: %s" % money(cod_ref_cost / 2))

    print("\nTotal return cost %s. 1 + 2 (half) + 3 = %s (%.0f%%)"
          % (money(total), money(save_a + cod_ref_cost / 2 + save_c), 100 * (save_a + cod_ref_cost / 2 + save_c) / total))


if __name__ == "__main__":
    main()
