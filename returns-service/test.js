var test = require('node:test')
var assert = require('node:assert')
var decide = require('./returns').decide

var DAY = 86400000
var now = Date.parse('2026-10-10T10:00:00Z')

function order(extra) {
  return Object.assign({
    order_number: 'ORD-' + Math.floor(Math.random() * 100000),
    status: 'delivered',
    delivered_at: new Date(now - 2 * DAY).toISOString(),
    payment: 'prepaid',
    coupon_discount: 0,
    shipping_fee: 49,
    items: [{ sku: 'watering-can', kind: 'tool', qty: 1, price: 329 }]
  }, extra)
}

test('tool inside the window is approved', function () {
  var d = decide(order(), { items: [{ sku: 'watering-can', qty: 1 }], reason: 'changed my mind' }, [], now)
  assert.equal(d.status, 'approved')
  assert.equal(d.refund_amount, 329)
  assert.equal(d.method, 'refund')
})

test('order that is not delivered is rejected', function () {
  var d = decide(order({ status: 'shipped' }), { items: [{ sku: 'watering-can', qty: 1 }] }, [], now)
  assert.equal(d.status, 'rejected')
})

test('seeds cannot be returned', function () {
  var o = order({ items: [{ sku: 'basil-seeds', kind: 'seed', qty: 1, price: 69 }] })
  var d = decide(o, { items: [{ sku: 'basil-seeds', qty: 1 }], reason: 'changed my mind' }, [], now)
  assert.equal(d.status, 'rejected')
})

test('damaged plant without a photo goes to a person', function () {
  var o = order({ items: [{ sku: 'peace-lily', kind: 'plant', qty: 1, price: 449 }] })
  var d = decide(o, { items: [{ sku: 'peace-lily', qty: 1 }], reason: 'arrived damaged' }, [], now)
  assert.equal(d.status, 'needs_review')
})

test('damaged plant with a photo gets shipping back too', function () {
  var o = order({ items: [{ sku: 'peace-lily', kind: 'plant', qty: 1, price: 449 }] })
  var d = decide(o, { items: [{ sku: 'peace-lily', qty: 1 }], reason: 'arrived damaged', photo: true }, [], now)
  assert.equal(d.status, 'approved')
  assert.equal(d.refund_amount, 498)
})

test('cash on delivery gets store credit', function () {
  var d = decide(order({ payment: 'cod' }), { items: [{ sku: 'watering-can', qty: 1 }], reason: 'not needed' }, [], now)
  assert.equal(d.method, 'credit')
})

test('asking for credit gives 5% extra', function () {
  var d = decide(order(), { items: [{ sku: 'watering-can', qty: 1 }], reason: 'not needed', want: 'credit' }, [], now)
  assert.equal(d.refund_amount, 345.45)
})

test('cannot return more than was bought', function () {
  var o = order()
  var earlier = [{ status: 'approved', items: [{ sku: 'watering-can', qty: 1 }] }]
  var d = decide(o, { items: [{ sku: 'watering-can', qty: 1 }], reason: 'not needed' }, earlier, now)
  assert.equal(d.status, 'rejected')
})
