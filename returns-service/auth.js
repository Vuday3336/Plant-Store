var crypto = require('crypto')
var db = require('./db')

// token -> { username, role, expires }
// The token used to be base64("username:role"), so anyone could write their
// own manager token. Now it is a random value the server hands out at login
// and looks up on every request. Kept in memory: a restart logs everyone out.
var sessions = new Map()
var TOKEN_HOURS = 8

function login(username, password) {
  var user = db.data.users.find(function (u) { return u.username == username })
  if (!user) return { error: 'no such user' }
  if (user.password != db.hash(password)) return { error: 'wrong password' }
  var token = crypto.randomBytes(32).toString('hex')
  sessions.set(token, { username: user.username, role: user.role, expires: Date.now() + TOKEN_HOURS * 3600000 })
  return { token: token }
}

// returns { username, role } or null
function check(token) {
  if (typeof token != 'string' || !token) return null
  var s = sessions.get(token)
  if (!s) return null
  if (s.expires < Date.now()) {
    sessions.delete(token)
    return null
  }
  return { username: s.username, role: s.role }
}

module.exports = { login, check }
