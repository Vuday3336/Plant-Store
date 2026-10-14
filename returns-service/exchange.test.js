var test = require('node:test')
var assert = require('node:assert')
var decide = require('./returns').decide

var DAY = 86400000
var now = Date.parse('2026-10-10T10:00:00Z')
var n = 0

function order(items, extra) {
  return Object.assign({
    order_number: 'ORD-EX-' + n++,
    status: 'delivered',
    delivered_at: new Date(now - 2 * DAY).toISOString(),
    payment: 'prepaid',
    coupon_discount: 0,
    shipping_fee: 49,
    items: items
  }, extra)
}

var can = { sku: 'watering-can', kind: 'tool', qty: 1, price: 329 }
var lily = { sku: 'peace-lily', kind: 'plant', qty: 1, price: 449 }
var pots = { sku: 'clay-pot-8', kind: 'pot', qty: 2, price: 189 }
var seeds = { sku: 'basil-seeds', kind: 'seed', qty: 1, price: 69 }

function ask(o, items, exchangeFor, extra) {
  return decide(o, Object.assign({ items: items, reason: 'not needed', want: 'exchange', exchange_for: exchangeFor }, extra), [], now)
}

test('new item costs more: customer pays the difference', function () {
  var d = ask(order([can]), [{ sku: 'watering-can', qty: 1 }], 'pruning-shears')
  assert.equal(d.status, 'approved')
  assert.equal(d.method, 'exchange')
  assert.equal(d.refund_amount, 0)
  assert.equal(d.pay_amount, 220) // 549 - 329
  assert.equal(d.credit_amount, 0)
  assert.equal(d.exchange_for, 'pruning-shears')
})

test('new item costs less: customer gets the difference as credit, no shipping back', function () {
  // a whole damaged order would get shipping back on a refund; not on an exchange
  var d = ask(order([lily]), [{ sku: 'peace-lily', qty: 1 }], 'money-plant', { reason: 'arrived damaged', photo: true })
  assert.equal(d.status, 'approved')
  assert.equal(d.credit_amount, 200) // 449 - 249
  assert.equal(d.pay_amount, 0)
  assert.equal(d.refund_amount, 0)
})

test('same quantity: two pots for two pots', function () {
  var d = ask(order([pots]), [{ sku: 'clay-pot-8', qty: 2 }], 'ceramic-pot-6')
  assert.equal(d.exchange_qty, 2)
  assert.equal(d.pay_amount, 220) // 2 x 299 - 2 x 189
})

test('what comes back is worth its price less its share of the coupon', function () {
  // order is 329 + 2 x 189 = 707 with 70.70 off; the can carries 70.70 x 329/707 = 32.90 of it
  var d = ask(order([can, pots], { coupon_discount: 70.7 }), [{ sku: 'watering-can', qty: 1 }], 'pruning-shears')
  assert.equal(d.returned_value, 296.1)
  assert.equal(d.pay_amount, 252.9)
})

test('no 5% extra on an exchange, and cash on delivery does not turn it into credit', function () {
  var d = ask(order([can], { payment: 'cod' }), [{ sku: 'watering-can', qty: 1 }], 'clay-pot-8')
  assert.equal(d.method, 'exchange')
  assert.equal(d.credit_amount, 140) // 329 - 189, not 329 x 1.05 - 189
})

test('the same rules decide whether it can come back', function () {
  var d = ask(order([seeds]), [{ sku: 'basil-seeds', qty: 1 }], 'tomato-seeds')
  assert.equal(d.status, 'rejected')
  assert.deepEqual(d.messages, ['basil-seeds: seeds cannot be returned'])

  var late = ask(order([can], { delivered_at: new Date(now - 10 * DAY).toISOString() }), [{ sku: 'watering-can', qty: 1 }], 'pruning-shears')
  assert.equal(late.status, 'rejected')

  var noPhoto = ask(order([lily]), [{ sku: 'peace-lily', qty: 1 }], 'snake-plant', { reason: 'arrived damaged' })
  assert.equal(noPhoto.status, 'needs_review')
  assert.equal(noPhoto.method, 'exchange')
})

test('only the items that can come back are exchanged', function () {
  var d = ask(order([can, seeds]), [{ sku: 'watering-can', qty: 1 }, { sku: 'basil-seeds', qty: 1 }], 'pruning-shears')
  assert.equal(d.status, 'approved')
  assert.equal(d.exchange_qty, 1)
  assert.equal(d.pay_amount, 220)
  assert.deepEqual(d.messages, ['basil-seeds: seeds cannot be returned'])
})

test('a person looks at an exchange worth over Rs 2000', function () {
  var big = { sku: 'pruning-shears', kind: 'tool', qty: 4, price: 549 }
  var d = ask(order([big]), [{ sku: 'pruning-shears', qty: 4 }], 'watering-can')
  assert.equal(d.status, 'needs_review')
  assert.equal(d.credit_amount, 880) // 4 x 549 - 4 x 329
})

test('exchange_for has to be something we sell', function () {
  assert.equal(ask(order([can]), [{ sku: 'watering-can', qty: 1 }], 'gold-bar').status, 'rejected')
  assert.equal(ask(order([can]), [{ sku: 'watering-can', qty: 1 }], undefined).status, 'rejected')
  assert.equal(ask(order([can]), [{ sku: 'watering-can', qty: 1 }], 'toString').status, 'rejected')
})

test('refunds and credit are unchanged', function () {
  var d = decide(order([can]), { items: [{ sku: 'watering-can', qty: 1 }], reason: 'not needed', want: 'credit', exchange_for: 'pruning-shears' }, [], now)
  assert.equal(d.method, 'credit')
  assert.equal(d.refund_amount, 345.45)
  assert.equal(d.pay_amount, undefined)
})
