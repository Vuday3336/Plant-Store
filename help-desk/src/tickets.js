// Tickets and the emails they need. A ticket and its email row are written in
// one transaction, so there is never a ticket without its email or the other
// way round. The outbox sends the emails later.
const { immediate, getSetting } = require("./db");

// "  The pot  is BROKEN " and "the pot is broken" are the same message
function messageKey(message) {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
}

function confirmationEmail(ticket) {
  return {
    subject: `We got your message about order ${ticket.order_number} (ticket #${ticket.id})`,
    body:
      `Hello${ticket.customer_name ? " " + ticket.customer_name : ""},\n\n` +
      `Thank you for telling us about a problem with order ${ticket.order_number}. ` +
      `Our team has your message and will email you when it is sorted.\n\n` +
      `Your message:\n${ticket.message}\n\n` +
      `Ticket number: ${ticket.id}\n`,
  };
}

function resolvedEmail(ticket) {
  return {
    subject: `Your problem with order ${ticket.order_number} is resolved (ticket #${ticket.id})`,
    body:
      `Hello${ticket.customer_name ? " " + ticket.customer_name : ""},\n\n` +
      `Our team has marked your ticket about order ${ticket.order_number} as resolved.\n\n` +
      `Your message was:\n${ticket.message}\n\n` +
      `If something is still wrong, reply on the help page and we will look again.\n`,
  };
}

function createTickets({ db, dedupeMs }) {
  const dbId = getSetting(db, "db_id");

  const byRequestId = db.prepare("SELECT * FROM tickets WHERE request_id = ?");
  const sameMessage = db.prepare(
    "SELECT * FROM tickets WHERE order_number = ? AND message_key = ? AND created_at >= ? ORDER BY id LIMIT 1"
  );
  const insertTicket = db.prepare(
    "INSERT INTO tickets (order_number, contact, customer_name, customer_email, message, message_key, request_id, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const byId = db.prepare("SELECT * FROM tickets WHERE id = ?");
  const insertEmail = db.prepare(
    "INSERT INTO emails (ticket_id, kind, idempotency_key, to_addr, subject, body, next_attempt_at, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING"
  );
  const markResolved = db.prepare(
    "UPDATE tickets SET status = 'resolved', resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'open'"
  );
  const listAll = db.prepare("SELECT * FROM tickets ORDER BY created_at DESC, id DESC");
  const emailsFor = db.prepare(
    "SELECT ticket_id, kind, status, attempts, last_error, sent_at, next_attempt_at FROM emails WHERE ticket_id = ? ORDER BY id"
  );
  const allEmails = db.prepare("SELECT ticket_id, kind, status, attempts, last_error, sent_at, next_attempt_at FROM emails ORDER BY id");

  function queueEmail(ticket, kind, content, now) {
    // the key is fixed when the row is made; every retry, from any copy of the
    // app, sends this same key, and the store API sends the email only once
    const key = `helpdesk-${dbId}-ticket-${ticket.id}-${kind}`;
    insertEmail.run(ticket.id, kind, key, ticket.customer_email, content.subject, content.body, now, now);
  }

  // Returns { ticket, created } where created is false for a repeat.
  function create({ order, orderNumber, contact, message, requestId }) {
    const key = messageKey(message);
    return immediate(db, () => {
      const now = Date.now();
      if (requestId) {
        const again = byRequestId.get(requestId);
        if (again && again.order_number === orderNumber) return { ticket: again, created: false };
        if (again) requestId = null; // someone else's id: ignore it rather than fail
      }
      const recent = sameMessage.get(orderNumber, key, now - dedupeMs);
      if (recent) return { ticket: recent, created: false };

      const info = insertTicket.run(orderNumber, contact, order.name || null, order.email, message.trim(), key, requestId || null, now);
      const ticket = byId.get(info.lastInsertRowid);
      queueEmail(ticket, "confirmation", confirmationEmail(ticket), now);
      return { ticket, created: true };
    });
  }

  // Returns { ticket, changed } or null if there is no such ticket.
  function resolve(id, by) {
    return immediate(db, () => {
      const now = Date.now();
      const info = markResolved.run(now, by, id);
      const ticket = byId.get(id);
      if (!ticket) return null;
      if (info.changes === 1) queueEmail(ticket, "resolved", resolvedEmail(ticket), now);
      return { ticket, changed: info.changes === 1 };
    });
  }

  function get(id) {
    const ticket = byId.get(id);
    return ticket ? { ...ticket, emails: emailsFor.all(id) } : null;
  }

  function list() {
    const emails = new Map();
    for (const e of allEmails.all()) {
      if (!emails.has(e.ticket_id)) emails.set(e.ticket_id, []);
      emails.get(e.ticket_id).push(e);
    }
    return listAll.all().map((t) => ({ ...t, emails: emails.get(t.id) || [] }));
  }

  return { create, resolve, get, list };
}

module.exports = { createTickets, messageKey };
