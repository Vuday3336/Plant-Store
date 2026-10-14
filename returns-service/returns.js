// decides what happens to a return request
// server.js calls decide(order, request, earlier, now)
//   order    the order from the database
//   request  what the customer sent: { items: [{sku, qty}], reason, want, photo, exchange_for }
//            want is "refund", "credit" or "exchange"
//   earlier  earlier return requests for the same order
//   now      current time in ms
//
// To change a rule, change the tables below (REASONS, ITEM_RULES, MONEY).
// decide-same.test.js checks that the answers are the same as before the
// clean-up, so run `node --test` after any change.

var products = require('./products')

var DAY = 86400000

// What the customer's reason text means. The first match wins.
var REASONS = [
  { type: 'damaged', match: /damage|broken|dead|dried/ },
  { type: 'wrong', match: /wrong|not what|different/ },
  { type: 'mind', match: /mind|don.?t want|not needed|no longer/ }
]

// What can come back, per kind of item.
//   onlyFor            reasons accepted; leave out to accept any reason
//   notAccepted        message when the reason is not accepted
//   lastDay            last whole day after delivery that is still in the window
//   photoWhenDamaged   damaged without a photo goes to a person
//   bulkOver           more than this many in one request goes to a person
// Any kind not listed here uses `other`.
var ITEM_RULES = {
  seed: { onlyFor: ['wrong'], notAccepted: 'seeds cannot be returned', lastDay: 7 },
  plant: { onlyFor: ['damaged', 'wrong'], notAccepted: 'plants can only be returned if damaged or wrong', lastDay: 3, photoWhenDamaged: true },
  // tools close a day earlier than pots and the rest; that is how it was, see ANSWERS.md
  tool: { lastDay: 6, photoWhenDamaged: true },
  pot: { lastDay: 7, photoWhenDamaged: true, bulkOver: 5, bulkMessage: 'bulk pot return' },
  other: { lastDay: 7 }
}

var MONEY = {
  creditBonus: 1.05, // a customer who asks for store credit gets 5% extra
  reviewOver: 2000, // over this a person looks at it
  shippingBackFor: ['damaged', 'wrong'], // when the whole order comes back for these
  repeatsBeforeReview: 2 // see repeatCounter
}

// Counts requests for the same order that arrive one after another, across
// calls, in this process. It is how the code always worked; see ANSWERS.md.
var repeatCounter = { lastOrder: null, count: 0 }

function countRepeat(orderNumber) {
  if (repeatCounter.lastOrder == orderNumber) {
    repeatCounter.count = repeatCounter.count + 1
  } else {
    repeatCounter.count = 0
    repeatCounter.lastOrder = orderNumber
  }
  return repeatCounter.count
}

function rejected(messages) {
  return { status: 'rejected', refund_amount: 0, method: null, messages: messages }
}

function round2(x) {
  return Math.round(x * 100) / 100
}

function reasonType(text) {
  var reason = (text || '').toLowerCase()
  for (var i = 0; i < REASONS.length; i++) {
    if (REASONS[i].match.test(reason)) return REASONS[i].type
  }
  return 'other'
}

function rulesFor(kind) {
  return Object.prototype.hasOwnProperty.call(ITEM_RULES, kind) ? ITEM_RULES[kind] : ITEM_RULES.other
}

// The order line for a sku. If the order has the sku twice the last line wins.
function orderLine(order, sku) {
  var found = null
  for (var i = 0; i < order.items.length; i++) {
    if (order.items[i].sku == sku) found = order.items[i]
  }
  return found
}

// How many of this sku earlier requests (that were not rejected) already asked for.
function alreadyReturned(earlier, sku) {
  var done = 0
  earlier.forEach(function (e) {
    if (e.status == 'rejected') return
    e.items.forEach(function (it) {
      if (it.sku == sku) done = done + (it.qty || 1)
    })
  })
  return done
}

// Checks one requested line. Returns { refused: message } or
// { qty, line, done, review: [messages] }.
function checkItem(order, wanted, earlier, type, days, photo) {
  var line = orderLine(order, wanted.sku)
  if (!line) return { refused: wanted.sku + ' is not in this order' }

  var done = alreadyReturned(earlier, wanted.sku)
  var qty = wanted.qty || 1
  if (qty + done > line.qty) return { refused: 'only ' + (line.qty - done) + ' of ' + line.sku + ' can be returned' }

  var rule = rulesFor(line.kind)
  if (rule.onlyFor && rule.onlyFor.indexOf(type) == -1) return { refused: line.sku + ': ' + rule.notAccepted }
  if (days > rule.lastDay) return { refused: line.sku + ': return window is over' }

  var review = []
  if (rule.photoWhenDamaged && type == 'damaged' && !photo) review.push(line.sku + ': photo needed')
  if (rule.bulkOver && qty > rule.bulkOver) review.push(rule.bulkMessage)
  return { qty: qty, line: line, done: done, review: review }
}

// Price of what comes back, less its share of the order's coupon.
function valueAfterCoupon(order, accepted) {
  var total = 0
  accepted.forEach(function (a) { total = total + a.line.price * a.qty })
  if (order.coupon_discount) {
    var orderTotal = 0
    order.items.forEach(function (it) { orderTotal = orderTotal + it.price * it.qty })
    total = total - order.coupon_discount * (total / orderTotal)
  }
  return total
}

// True when everything still returnable on the order is coming back now.
function wholeOrder(order, accepted) {
  if (accepted.length != order.items.length) return false
  return accepted.every(function (a) { return a.qty == a.line.qty - a.done })
}

function productBySku(sku) {
  return products.find(function (p) { return p.sku === sku }) || null
}

// Same items come back as for a refund; the customer gets the same number of
// `product` instead. What comes back is worth its price less its share of the
// coupon: no 5% extra and no shipping. The difference is paid or credited.
function exchange(order, accepted, product, review, repeats, messages) {
  var count = 0
  accepted.forEach(function (a) { count = count + Number(a.qty) })
  var value = round2(valueAfterCoupon(order, accepted))
  var newCost = round2(product.price * count)
  var difference = round2(newCost - value)

  if (value > MONEY.reviewOver) review = true
  if (repeats >= MONEY.repeatsBeforeReview) {
    review = true
    messages.push('repeated requests for this order')
  }

  return {
    status: review ? 'needs_review' : 'approved',
    refund_amount: 0,
    method: 'exchange',
    messages: messages,
    exchange_for: product.sku,
    exchange_qty: count,
    returned_value: value,
    pay_amount: difference > 0 ? difference : 0,
    credit_amount: difference < 0 ? -difference : 0
  }
}

function decide(order, req, earlier, now) {
  if (!order) return rejected(['order not found'])
  var repeats = countRepeat(order.order_number)

  if (order.status == 'cancelled') return rejected(['order was cancelled'])
  if (order.status != 'delivered') return rejected(['order not delivered yet'])
  if (!req.items || req.items.length == 0) return rejected(['no items'])

  var wantedProduct = null
  if (req.want == 'exchange') {
    wantedProduct = productBySku(req.exchange_for)
    if (!wantedProduct) return rejected(['exchange_for must be a sku from the product list'])
  }

  var type = reasonType(req.reason)
  var days = Math.floor((now - new Date(order.delivered_at).getTime()) / DAY)

  var messages = []
  var accepted = []
  var refusedAny = false
  var review = false
  req.items.forEach(function (wanted) {
    var result = checkItem(order, wanted, earlier, type, days, req.photo)
    if (result.refused) {
      messages.push(result.refused)
      refusedAny = true
      return
    }
    if (result.review.length) review = true
    messages.push.apply(messages, result.review)
    accepted.push(result)
  })

  if (refusedAny && accepted.length == 0) return rejected(messages)

  if (req.want == 'exchange') {
    return exchange(order, accepted, wantedProduct, review, repeats, messages)
  }

  var amount = valueAfterCoupon(order, accepted)
  if (wholeOrder(order, accepted) && MONEY.shippingBackFor.indexOf(type) != -1) amount = amount + order.shipping_fee
  amount = round2(amount)

  var method = 'refund'
  if (order.payment == 'cod') method = 'credit'
  if (req.want == 'credit') {
    method = 'credit'
    amount = round2(amount * MONEY.creditBonus)
  }

  if (amount > MONEY.reviewOver) review = true
  if (repeats >= MONEY.repeatsBeforeReview) {
    review = true
    messages.push('repeated requests for this order')
  }

  return { status: review ? 'needs_review' : 'approved', refund_amount: amount, method: method, messages: messages }
}

module.exports = { decide }
