# Returns service

Takes return requests from customers and lets the team approve or reject them.

    node server.js          starts it on port 4300 (PORT to change, DATA_FILE for the data file)
    node --test             runs the tests

The data is in data.json. It is made the first time you start the server. Delete it to start again.

Team logins: priya / garden123 (manager), sam / sam2026 (viewer). Only a manager should approve or reject.

## Customer

    POST  /returns               {order_number, items: [{sku, qty}], reason, want, photo, exchange_for}
                                 want is "refund", "credit" or "exchange"
                                 exchange_for is a sku from products.js (only for an exchange)
    GET   /returns/:id
    PATCH /returns/:id           change the reason or add a note
    POST  /returns/:id/photo     {filename, data}   data is base64

## Team

    POST /admin/login            {username, password} -> {token}
    GET  /admin/returns?status=  send the token as ?token= or as the x-token header
    POST /admin/returns/:id/approve
    POST /admin/returns/:id/reject
    GET  /admin/export

## How a return is decided

returns.js has one function, decide(order, request, earlier, now). server.js calls it.
Keep that name and those four arguments.

- Only delivered orders.
- Seeds: only if we sent the wrong ones, within 7 days.
- Plants: only if damaged or wrong, within 3 days. Damaged needs a photo, or a person looks at it.
- Tools and pots: within a week.
- The refund is the price of what comes back, less its share of any coupon.
- Shipping is refunded when the whole order comes back because it was damaged or wrong.
- Cash on delivery orders get store credit, not money.
- A customer who asks for store credit gets 5% extra.
- Over Rs 2000 a person looks at it.

## Exchange

- The same rules decide whether the items can come back.
- The customer gets the same number of `exchange_for` as the items that are accepted.
- What comes back is worth its price less its share of any coupon. No 5% extra and no shipping.
- The answer has `method: "exchange"`, `refund_amount: 0`, and either `pay_amount` (the new
  items cost more) or `credit_amount` (they cost less). Both are 0 when the prices match.
- Over Rs 2000 coming back, a person looks at it, like a refund.
