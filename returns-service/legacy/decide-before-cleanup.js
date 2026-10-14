// decides what happens to a return request
// server.js calls decide(order, request, earlier, now)
//   order    the order from the database
//   request  what the customer sent: { items: [{sku, qty}], reason, want, photo }
//   earlier  earlier return requests for the same order
//   now      current time in ms

var lastOrder = null
var sameCount = 0

function decide(order, req, earlier, now) {
  var msgs = []
  var total = 0
  var ok = true
  var review = false
  var f = false
  var all = true
  var chk = 0

  if (!order) {
    return { status: 'rejected', refund_amount: 0, method: null, messages: ['order not found'] }
  }

  if (lastOrder == order.order_number) {
    sameCount = sameCount + 1
  } else {
    sameCount = 0
    lastOrder = order.order_number
  }

  if (order.status == 'cancelled') {
    return { status: 'rejected', refund_amount: 0, method: null, messages: ['order was cancelled'] }
  }
  if (order.status != 'delivered') {
    return { status: 'rejected', refund_amount: 0, method: null, messages: ['order not delivered yet'] }
  }
  if (!req.items || req.items.length == 0) {
    return { status: 'rejected', refund_amount: 0, method: null, messages: ['no items'] }
  }

  var reason = (req.reason || '').toLowerCase()
  var type = 'other'
  if (/damage|broken|dead|dried/.test(reason)) type = 'damaged'
  else if (/wrong|not what|different/.test(reason)) type = 'wrong'
  else if (/mind|don.?t want|not needed|no longer/.test(reason)) type = 'mind'

  var days = Math.floor((now - new Date(order.delivered_at).getTime()) / 86400000)

  for (var i = 0; i < req.items.length; i++) {
    var ri = req.items[i]
    var item = null
    for (var j = 0; j < order.items.length; j++) {
      if (order.items[j].sku == ri.sku) item = order.items[j]
    }
    if (!item) {
      msgs.push(ri.sku + ' is not in this order')
      ok = false
      continue
    }

    // how many were already sent back
    var done = 0
    for (var k = 0; k < earlier.length; k++) {
      if (earlier[k].status != 'rejected') {
        for (var m = 0; m < earlier[k].items.length; m++) {
          if (earlier[k].items[m].sku == ri.sku) done = done + (earlier[k].items[m].qty || 1)
        }
      }
    }
    var qty = ri.qty || 1
    if (qty + done > item.qty) {
      msgs.push('only ' + (item.qty - done) + ' of ' + item.sku + ' can be returned')
      ok = false
      continue
    }

    if (item.kind == 'seed') {
      if (type == 'wrong') {
        // we sent the wrong seeds so we take them back
        if (days > 7) {
          msgs.push(item.sku + ': return window is over')
          ok = false
          continue
        }
      } else {
        msgs.push(item.sku + ': seeds cannot be returned')
        ok = false
        continue
      }
    } else if (item.kind == 'plant') {
      if (type == 'damaged') {
        if (days > 3) {
          msgs.push(item.sku + ': return window is over')
          ok = false
          continue
        }
        if (!req.photo) {
          review = true
          msgs.push(item.sku + ': photo needed')
        }
      } else if (type == 'wrong') {
        if (days > 3) {
          msgs.push(item.sku + ': return window is over')
          ok = false
          continue
        }
      } else {
        msgs.push(item.sku + ': plants can only be returned if damaged or wrong')
        ok = false
        continue
      }
    } else if (item.kind == 'tool') {
      var d2 = Math.floor((now - new Date(order.delivered_at).getTime()) / 86400000)
      if (d2 >= 7) {
        msgs.push(item.sku + ': return window is over')
        ok = false
        continue
      }
      if (type == 'damaged' && !req.photo) {
        review = true
        msgs.push(item.sku + ': photo needed')
      }
    } else if (item.kind == 'pot') {
      if (days > 7) {
        msgs.push(item.sku + ': return window is over')
        ok = false
        continue
      }
      if (type == 'damaged' && !req.photo) {
        review = true
        msgs.push(item.sku + ': photo needed')
      }
      if (item.kind == 'pot' && qty > 5) {
        review = true
        msgs.push('bulk pot return')
      }
    } else {
      if (days > 7) {
        msgs.push(item.sku + ': return window is over')
        ok = false
        continue
      }
    }

    if (qty != item.qty - done) all = false
    total = total + item.price * qty
    chk++
  }

  if (chk != order.items.length) all = false
  if (!ok && chk == 0) {
    return { status: 'rejected', refund_amount: 0, method: null, messages: msgs }
  }

  // take off the customer's share of the coupon
  if (order.coupon_discount) {
    var orderTotal = 0
    for (var n = 0; n < order.items.length; n++) {
      orderTotal = orderTotal + order.items[n].price * order.items[n].qty
    }
    total = total - order.coupon_discount * (total / orderTotal)
  }

  if (all && (type == 'damaged' || type == 'wrong')) f = true
  if (f) total = total + order.shipping_fee
  total = Math.round(total * 100) / 100

  var method = 'refund'
  if (order.payment == 'cod') method = 'credit'
  if (req.want == 'credit') {
    method = 'credit'
    total = Math.round(total * 1.05 * 100) / 100
  }

  if (total > 2000) review = true
  if (sameCount >= 2) {
    review = true
    msgs.push('repeated requests for this order')
  }

  return { status: review ? 'needs_review' : 'approved', refund_amount: total, method: method, messages: msgs }
}

module.exports = { decide }
