// The clean-up of decide must not change a single answer.
//
// legacy/decide-before-cleanup.js is returns.js exactly as it was before the
// clean-up. This test throws a lot of generated requests (fixed seed, so it is
// the same every run) at both and checks the answers are identical, in the
// same order, so the "repeated requests" counter is exercised the same way.
//
// want: "exchange" is left out on purpose: that is new behaviour.
var test = require('node:test')
var assert = require('node:assert')
var current = require('./returns').decide
var legacy = require('./legacy/decide-before-cleanup').decide

var DAY = 86400000
var now = Date.parse('2026-10-10T10:00:00Z')

// small seeded random generator (mulberry32) so failures can be reproduced
function rng(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

var catalog = [
  { sku: 'money-plant', kind: 'plant', price: 249 },
  { sku: 'peace-lily', kind: 'plant', price: 449 },
  { sku: 'tomato-seeds', kind: 'seed', price: 79 },
  { sku: 'basil-seeds', kind: 'seed', price: 69 },
  { sku: 'pruning-shears', kind: 'tool', price: 549 },
  { sku: 'watering-can', kind: 'tool', price: 329 },
  { sku: 'clay-pot-8', kind: 'pot', price: 189 },
  { sku: 'ceramic-pot-6', kind: 'pot', price: 299 },
  { sku: 'potting-mix-5kg', kind: 'other', price: 349 },
  { sku: 'big-planter', kind: 'pot', price: 2499 }
]
var reasons = [undefined, '', 'arrived damaged', 'Broken pot', 'plant is dead', 'leaves dried up', 'wrong item',
  'not what I ordered', 'different colour', 'changed my mind', "don't want it", 'dont want', 'not needed',
  'no longer needed', 'too small', 'DAMAGED and wrong', 'wrong and damaged']
var wants = [undefined, 'refund', 'credit', 'cash', '']
var statuses = ['delivered', 'delivered', 'delivered', 'delivered', 'shipped', 'cancelled', 'placed']
// whole days plus a few hours either side of the window edges
var ages = [0, 1, 2, 3, 3.5, 4, 6, 6.9, 7, 7.5, 8, 9, 30, -1]
var qtys = [undefined, 0, 1, 1, 1, 2, 2, 3, 6, 7, -1, 1.5, '1', '2']

function pick(r, list) {
  return list[Math.floor(r() * list.length)]
}

function makeOrder(r, n) {
  var items = []
  var count = 1 + Math.floor(r() * 3)
  for (var i = 0; i < count; i++) {
    var p = pick(r, catalog)
    items.push({ sku: p.sku, name: p.sku, kind: p.kind, qty: 1 + Math.floor(r() * 7), price: p.price })
  }
  var age = pick(r, ages)
  return {
    order_number: 'ORD-' + (2000 + n),
    status: pick(r, statuses),
    delivered_at: r() < 0.03 ? undefined : new Date(now - age * DAY - Math.floor(r() * 3) * 3600000).toISOString(),
    payment: r() < 0.3 ? 'cod' : 'prepaid',
    coupon_discount: r() < 0.3 ? pick(r, [50, 100, 75.5]) : 0,
    shipping_fee: 49,
    items: items
  }
}

function makeRequest(r, order) {
  var items = []
  var count = r() < 0.05 ? 0 : 1 + Math.floor(r() * 3)
  for (var i = 0; i < count; i++) {
    var sku = r() < 0.85 ? pick(r, order.items).sku : pick(r, catalog).sku
    if (r() < 0.03) sku = 'not-a-product'
    items.push({ sku: sku, qty: pick(r, qtys) })
  }
  var req = { items: r() < 0.02 ? undefined : items, reason: pick(r, reasons), want: pick(r, wants) }
  if (r() < 0.5) req.photo = r() < 0.8 ? true : 'leaf.jpg'
  return req
}

function makeEarlier(r, order) {
  var list = []
  var count = Math.floor(r() * 3)
  for (var i = 0; i < count; i++) {
    list.push({
      status: pick(r, ['approved', 'needs_review', 'rejected']),
      items: [{ sku: pick(r, order.items).sku, qty: pick(r, [undefined, 1, 2, 3]) }]
    })
  }
  return list
}

test('decide gives the same answer as before the clean-up', function () {
  var r = rng(20261013)
  var order = null
  var checked = 0
  for (var n = 0; n < 30000; n++) {
    // sometimes the same order again, sometimes nothing found, to hit the repeat counter
    var roll = r()
    if (!order || roll > 0.35) order = makeOrder(r, n)
    var o = roll < 0.02 ? null : order
    var req = makeRequest(r, order)
    var earlier = makeEarlier(r, order)
    var at = now + (r() < 0.1 ? Math.floor(r() * 5) * 3600000 : 0)

    var before = legacy(o, req, earlier, at)
    var after = current(o, req, earlier, at)
    assert.deepStrictEqual(after, before, 'case ' + n + ': ' + JSON.stringify({ o: o, req: req, earlier: earlier, at: at }))
    checked++
  }
  assert.equal(checked, 30000)
})

test('the generated cases reach every kind of answer', function () {
  // guards against a generator that only ever produces rejections
  var r = rng(7)
  var seen = {}
  for (var n = 0; n < 3000; n++) {
    var order = makeOrder(r, n)
    var d = legacy(order, makeRequest(r, order), makeEarlier(r, order), now)
    seen[d.status + '/' + d.method] = true
  }
  for (var k of ['approved/refund', 'approved/credit', 'needs_review/refund', 'needs_review/credit', 'rejected/null']) {
    assert.ok(seen[k], 'never produced ' + k)
  }
})
