// returns service
// run: node server.js     (PORT, DATA_FILE)
var http = require('http')
var fs = require('fs')
var path = require('path')
var url = require('url')
var crypto = require('crypto')
var db = require('./db')
var auth = require('./auth')
var decide = require('./returns').decide

var PORT = process.env.PORT || 4300

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(body))
}

var UPLOADS = path.join(__dirname, 'uploads')
var PHOTO_TYPES = ['.jpg', '.jpeg', '.png', '.webp', '.heic']

// The customer's filename is only used for its extension. The name on disk is
// made here, so "../server.js" and friends cannot leave the uploads folder.
function photoName(returnId, filename) {
  if (typeof filename != 'string') return null
  var ext = path.extname(filename).toLowerCase()
  if (PHOTO_TYPES.indexOf(ext) == -1) return null
  var name = 'return-' + returnId + '-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext
  if (path.dirname(path.join(UPLOADS, name)) != UPLOADS) return null
  return name
}

function findReturn(id) {
  return db.data.returns.find(function (r) { return r.id == id })
}

function handle(req, res, body) {
  var u = url.parse(req.url, true)
  var p = u.pathname
  var q = u.query
  console.log(new Date().toISOString(), req.method, req.url, JSON.stringify(body))

  // ---- customer
  if (req.method == 'POST' && p == '/returns') {
    var order = db.data.orders.find(function (o) { return o.order_number == body.order_number })
    var earlier = db.data.returns.filter(function (r) { return r.order_number == body.order_number })
    var d = decide(order, body, earlier, Date.now())
    if (d.status == 'rejected') return send(res, 400, d)
    var ret = {
      id: db.data.returns.length + 1,
      order_number: order.order_number,
      items: body.items,
      reason: body.reason,
      want: body.want || 'refund',
      photo: body.photo || false,
      status: d.status,
      refund_amount: d.refund_amount,
      method: d.method,
      messages: d.messages,
      customer: { name: order.name, phone: order.phone, email: order.email, address: order.address },
      created_at: new Date().toISOString()
    }
    if (d.method == 'exchange') {
      ret.exchange_for = d.exchange_for
      ret.exchange_qty = d.exchange_qty
      ret.returned_value = d.returned_value
      ret.pay_amount = d.pay_amount
      ret.credit_amount = d.credit_amount
    }
    db.data.returns.push(ret)
    db.save()
    return send(res, 201, ret)
  }

  var m = p.match(/^\/returns\/(\d+)$/)
  if (m && req.method == 'GET') {
    var r = findReturn(m[1])
    if (!r) return send(res, 404, { error: 'not found' })
    return send(res, 200, r)
  }

  // customer can fix the reason or add a note
  if (m && req.method == 'PATCH') {
    var r2 = findReturn(m[1])
    if (!r2) return send(res, 404, { error: 'not found' })
    Object.assign(r2, body)
    db.save()
    return send(res, 200, r2)
  }

  m = p.match(/^\/returns\/(\d+)\/photo$/)
  if (m && req.method == 'POST') {
    var r3 = findReturn(m[1])
    if (!r3) return send(res, 404, { error: 'not found' })
    var name = photoName(r3.id, body.filename)
    if (!name) return send(res, 400, { error: 'filename must be a .jpg, .jpeg, .png, .webp or .heic image' })
    if (typeof body.data != 'string') return send(res, 400, { error: 'data must be base64 text' })
    fs.writeFileSync(path.join(UPLOADS, name), Buffer.from(body.data, 'base64'))
    r3.photo = true
    r3.photo_file = name
    db.save()
    return send(res, 200, { ok: true })
  }

  // ---- team
  if (req.method == 'POST' && p == '/admin/login') {
    var out = auth.login(body.username, body.password)
    if (out.error) return send(res, 401, out)
    return send(res, 200, out)
  }

  if (p.indexOf('/admin/') == 0) {
    var user = auth.check(q.token || req.headers['x-token'])
    if (!user) return send(res, 401, { error: 'login needed' })

    if (req.method == 'GET' && p == '/admin/returns') {
      var list = db.data.returns
      if (q.status) {
        // compare as data; this used to build code out of the query string
        list = list.filter(function (r) { return r.status == q.status })
      }
      return send(res, 200, list)
    }

    m = p.match(/^\/admin\/returns\/(\d+)\/(approve|reject)$/)
    if (m && req.method == 'POST') {
      var r4 = findReturn(m[1])
      if (!r4) return send(res, 404, { error: 'not found' })
      r4.status = m[2] == 'approve' ? 'approved' : 'rejected'
      r4.decided_by = user.username
      db.save()
      return send(res, 200, r4)
    }

    if (req.method == 'GET' && p == '/admin/export') {
      return send(res, 200, db.data)
    }
  }

  send(res, 404, { error: 'not found' })
}

http.createServer(function (req, res) {
  var text = ''
  req.on('data', function (c) { text += c })
  req.on('end', function () {
    try {
      handle(req, res, text ? JSON.parse(text) : {})
    } catch (e) {
      send(res, 500, { error: e.message, stack: e.stack })
    }
  })
}).listen(PORT, function () {
  console.log('returns service on ' + PORT)
})
