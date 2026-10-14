// the product list; db.js seeds the data file from it and returns.js uses it
// to price an exchange
module.exports = [
  { sku: 'money-plant', name: 'Money plant', kind: 'plant', price: 249 },
  { sku: 'peace-lily', name: 'Peace lily', kind: 'plant', price: 449 },
  { sku: 'snake-plant', name: 'Snake plant', kind: 'plant', price: 399 },
  { sku: 'tomato-seeds', name: 'Tomato seeds', kind: 'seed', price: 79 },
  { sku: 'basil-seeds', name: 'Basil seeds', kind: 'seed', price: 69 },
  { sku: 'pruning-shears', name: 'Pruning shears', kind: 'tool', price: 549 },
  { sku: 'watering-can', name: 'Watering can', kind: 'tool', price: 329 },
  { sku: 'clay-pot-8', name: 'Clay pot 8 inch', kind: 'pot', price: 189 },
  { sku: 'ceramic-pot-6', name: 'Ceramic pot 6 inch', kind: 'pot', price: 299 },
  { sku: 'potting-mix-5kg', name: 'Potting mix 5 kg', kind: 'other', price: 349 }
]
