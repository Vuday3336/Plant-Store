// everything is kept in one json file
var fs = require('fs')
var crypto = require('crypto')

var FILE = process.env.DATA_FILE || __dirname + '/data.json'

var products = require('./products')

function seed() {
  var names = ['Asha Rao', 'Vikram Nair', 'Meera Shah', 'Rohan Das', 'Kavya Iyer', 'Imran Khan']
  var orders = []
  for (var i = 1; i <= 30; i++) {
    var name = names[i % names.length]
    var items = []
    for (var j = 0; j < 1 + (i % 3); j++) {
      var p = products[(i + j * 3) % products.length]
      items.push({ sku: p.sku, name: p.name, kind: p.kind, qty: 1 + ((i + j) % 2), price: p.price })
    }
    orders.push({
      order_number: 'ORD-' + (2000 + i),
      name: name,
      phone: '90000' + String(20000 + i * 91).slice(-5),
      email: name.toLowerCase().replace(' ', '.') + i + '@example.com',
      address: (10 + i) + ', Garden Road, Pune 4110' + String(10 + (i % 40)),
      status: i % 9 == 0 ? 'cancelled' : i % 7 == 0 ? 'shipped' : 'delivered',
      delivered_at: new Date(Date.now() - (i % 10) * 86400000 - 3600000).toISOString(),
      payment: i % 4 == 0 ? 'cod' : 'prepaid',
      coupon_discount: i % 5 == 0 ? 50 : 0,
      shipping_fee: 49,
      items: items
    })
  }
  return {
    products: products,
    orders: orders,
    returns: [],
    users: [
      { username: 'priya', role: 'manager', password: hash('garden123') },
      { username: 'sam', role: 'viewer', password: hash('sam2026') }
    ]
  }
}

function hash(p) {
  return crypto.createHash('md5').update(p).digest('hex')
}

var data
if (fs.existsSync(FILE)) data = JSON.parse(fs.readFileSync(FILE, 'utf8'))
else {
  data = seed()
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2))
}

function save() {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2))
}

module.exports = { data, save, hash }
