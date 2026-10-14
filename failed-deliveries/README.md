# Failed deliveries

shipments.csv has every parcel the store sent in the last 60 days. One row is one parcel.

| Column | Meaning |
| --- | --- |
| shipment_id | The parcel. |
| order_number | The order it belongs to. |
| shipped_on | The day it left the warehouse. |
| courier | Who carried it. |
| city, pincode | Where it was going. |
| payment | prepaid or cod (cash on delivery). |
| order_value | What the customer pays for the order, in rupees. |
| shipping_cost | What the courier charges us for one way, in rupees. |
| attempts | How many times the courier tried to deliver. |
| status | delivered, returned (it came back to the warehouse), failed_open (an attempt failed and the courier still has it) or in_transit. |
| fail_reason | Why the latest failed attempt failed: not_home, wrong_address, refused or phone_off. Empty if no attempt failed. |
| customer_contacted | yes if the team contacted the customer after a failed attempt. |
| closed | For a returned parcel: yes when the team has finished dealing with it. |
| reship_of | If this parcel is a second try for the same order, the shipment_id of the first parcel. |

## What a returned parcel costs

The shipping cost twice (out and back) plus 40% of the order value, because the plants do not survive the trip.

## What the team does with a parcel

For a parcel with status failed_open, use the first line that fits:

1. The customer refused it: RETURN
2. Three attempts were made: RETURN
3. Wrong address: ASK_ADDRESS
4. The customer was not contacted yet: CONTACT
5. Anything else: RETRY

For a parcel with status returned that is not closed:

6. The order has already been sent again: nothing to do
7. Prepaid: ASK_CHOICE (ask the customer if they want it sent again, store credit or a refund)
8. Cash on delivery: CLOSE

All other parcels need nothing.
