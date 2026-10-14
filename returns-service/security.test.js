// One test for each of the three security fixes. Each starts the real server
// on a free port with its own data file, so nothing here touches data.json.
var test = require('node:test')
var assert = require('node:assert')
var fs = require('fs')
var os = require('os')
var path = require('path')
var net = require('net')
var crypto = require('crypto')
var child = require('child_process')

var md5 = function (s) { return crypto.createHash('md5').update(s).digest('hex') }

function freePort() {
  return new Promise(function (resolve) {
    var s = net.createServer().listen(0, function () {
      var port = s.address().port
      s.close(function () { resolve(port) })
    })
  })
}

async function startServer() {
  var dataFile = path.join(os.tmpdir(), 'returns-test-' + process.pid + '-' + Date.now() + '.json')
  fs.writeFileSync(dataFile, JSON.stringify({
    products: [],
    orders: [{
      order_number: 'ORD-9001', name: 'Test Person', phone: '9000000001', email: 'test@example.com',
      address: '1 Garden Road', status: 'delivered', delivered_at: new Date(Date.now() - 86400000).toISOString(),
      payment: 'prepaid', coupon_discount: 0, shipping_fee: 49,
      items: [{ sku: 'watering-can', name: 'Watering can', kind: 'tool', qty: 1, price: 329 }]
    }],
    returns: [],
    users: [
      { username: 'priya', role: 'manager', password: md5('garden123') },
      { username: 'sam', role: 'viewer', password: md5('sam2026') }
    ]
  }))
  var port = await freePort()
  var proc = child.spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, { PORT: String(port), DATA_FILE: dataFile }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  await new Promise(function (resolve, reject) {
    proc.stdout.on('data', function (c) { if (String(c).indexOf('returns service on') != -1) resolve() })
    proc.on('exit', function (code) { reject(new Error('server exited with ' + code)) })
  })
  var base = 'http://127.0.0.1:' + port
  return {
    proc: proc,
    call: async function (method, p, body, headers) {
      var res = await fetch(base + p, {
        method: method,
        headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
        body: body ? JSON.stringify(body) : undefined
      })
      var text = await res.text()
      return { status: res.status, body: text ? JSON.parse(text) : null }
    },
    stop: function () {
      proc.kill()
      try { fs.unlinkSync(dataFile) } catch (e) {}
    }
  }
}

async function login(s, user, pass) {
  var r = await s.call('POST', '/admin/login', { username: user, password: pass })
  assert.equal(r.status, 200)
  return r.body.token
}

test('a home-made token does not get into the team pages', async function (t) {
  var s = await startServer()
  t.after(s.stop)

  // what the old auth.js accepted: base64("anyone:manager")
  var forged = Buffer.from('mallory:manager').toString('base64')
  assert.equal((await s.call('GET', '/admin/export', null, { 'x-token': forged })).status, 401)
  assert.equal((await s.call('GET', '/admin/export?token=' + encodeURIComponent(forged))).status, 401)
  assert.equal((await s.call('POST', '/admin/returns/1/approve', null, { 'x-token': forged })).status, 401)
  assert.equal((await s.call('GET', '/admin/returns', null, { 'x-token': 'cHJpeWE6bWFuYWdlcg==' })).status, 401)

  // a real login still works, by header and by ?token=
  var token = await login(s, 'priya', 'garden123')
  assert.equal((await s.call('GET', '/admin/returns', null, { 'x-token': token })).status, 200)
  assert.equal((await s.call('GET', '/admin/returns?token=' + token)).status, 200)
})

test('the status filter is compared, not run as code', async function (t) {
  var s = await startServer()
  t.after(s.stop)
  var created = await s.call('POST', '/returns', { order_number: 'ORD-9001', items: [{ sku: 'watering-can', qty: 1 }], reason: 'not needed' })
  assert.equal(created.status, 201)
  var token = await login(s, 'sam', 'sam2026')
  var list = function (status) {
    return s.call('GET', '/admin/returns?status=' + encodeURIComponent(status), null, { 'x-token': token })
  }

  // the filter still filters
  assert.equal((await list('approved')).body.length, 1)
  assert.equal((await list('rejected')).body.length, 0)

  // this used to return every return, whatever the status
  var injected = await list("' || true || '")
  assert.equal(injected.status, 200)
  assert.deepEqual(injected.body, [])

  // and this used to stop the server
  await list("'; process.exit(7); '")
  assert.equal(s.proc.exitCode, null, 'server is still running')
  assert.equal((await list('approved')).body.length, 1)
})

test('a photo upload cannot write outside the uploads folder', async function (t) {
  var s = await startServer()
  t.after(s.stop)
  var created = await s.call('POST', '/returns', { order_number: 'ORD-9001', items: [{ sku: 'watering-can', qty: 1 }], reason: 'not needed' })
  var id = created.body.id
  var marker = 'escape-' + crypto.randomBytes(4).toString('hex')
  var data = Buffer.from('not really a photo').toString('base64')
  t.after(function () {
    for (var f of fs.readdirSync(path.join(__dirname, 'uploads'))) {
      if (f.indexOf('return-' + id + '-') == 0) fs.unlinkSync(path.join(__dirname, 'uploads', f))
    }
  })

  // the old code wrote this next to server.js
  var bad = await s.call('POST', '/returns/' + id + '/photo', { filename: '../' + marker + '.js', data: data })
  assert.equal(bad.status, 400)
  assert.equal(fs.existsSync(path.join(__dirname, marker + '.js')), false)

  // a picture name with ../ in it is kept inside uploads
  var sneaky = await s.call('POST', '/returns/' + id + '/photo', { filename: '../../' + marker + '.png', data: data })
  assert.equal(sneaky.status, 200)
  assert.equal(fs.existsSync(path.join(__dirname, '..', marker + '.png')), false)
  var saved = (await s.call('GET', '/returns/' + id)).body.photo_file
  assert.match(saved, /^return-\d+-\d+-[0-9a-f]+\.png$/)
  assert.ok(fs.existsSync(path.join(__dirname, 'uploads', saved)))
})
