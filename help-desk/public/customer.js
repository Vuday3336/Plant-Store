// Customer page. Plain JS, no build step.
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var orderInput = $("order-number");
  var contactInput = $("contact");
  var lookupBtn = $("lookup");
  var result = $("result");
  var message = $("message");
  var sendBtn = $("send");
  var sendResult = $("send-result");
  var count = $("message-count");

  // The server answers within 10 s; this is only for a dead connection.
  var CLIENT_TIMEOUT_MS = 15000;

  // ---- keep what the customer typed if the page is reloaded (this tab only)
  var DRAFT = "helpdesk-draft";
  function saveDraft() {
    try {
      sessionStorage.setItem(DRAFT, JSON.stringify({ o: orderInput.value, c: contactInput.value, m: message.value }));
    } catch (e) { /* private mode: fine without it */ }
  }
  try {
    var saved = JSON.parse(sessionStorage.getItem(DRAFT) || "null");
    if (saved) {
      orderInput.value = saved.o || "";
      contactInput.value = saved.c || "";
      message.value = saved.m || "";
    }
  } catch (e) { /* ignore */ }
  [orderInput, contactInput, message].forEach(function (el) { el.addEventListener("input", saveDraft); });

  function updateCount() { count.textContent = message.value.length + " / 2000"; }
  message.addEventListener("input", updateCount);
  updateCount();

  // ---- helpers
  function show(box, kind, html) {
    box.className = "result " + kind;
    box.innerHTML = html;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function friendlyDate(iso) {
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  function busy(btn, on, label) {
    btn.disabled = on;
    btn.setAttribute("aria-busy", on ? "true" : "false");
    if (label) btn.textContent = label;
  }
  function newRequestId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  // POST JSON with a hard client timeout. Resolves { status, body } and never
  // rejects: a network problem comes back as status 0.
  function post(url, data) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, CLIENT_TIMEOUT_MS);
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
      signal: ctrl.signal
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) { return { status: res.status, body: body }; });
    }).catch(function () {
      return { status: 0, body: {} };
    }).finally(function () { clearTimeout(timer); });
  }

  // tell the person we are still on it if the store API is slow
  function slowNotice(box, text) {
    return setTimeout(function () { show(box, "info", esc(text)); }, 3000);
  }

  function missingFields() {
    if (!orderInput.value.trim()) return orderInput;
    if (!contactInput.value.trim()) return contactInput;
    return null;
  }

  function problemText(r) {
    if (r.status === 403) return "We could not find an order with that number and phone or email. Please check both and try again.";
    if (r.status === 503) return "We cannot reach our order system right now. What you typed is still here. Please try again in a minute.";
    if (r.status === 429) return (r.body && r.body.message) || "Too many tries. Please wait a minute and try again.";
    if (r.status === 0) return "We could not reach our help desk. Check your internet connection and try again. What you typed is still here.";
    return (r.body && r.body.message) || "Something went wrong on our side. Please try again.";
  }

  // Enter in a one-line field sends its form (some keyboards and assistive
  // tools do not trigger the browser's own implicit submit)
  Array.prototype.forEach.call(document.querySelectorAll('input[type="text"], input[type="password"]'), function (el) {
    el.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" || ev.isComposing || !el.form) return;
      ev.preventDefault();
      el.form.requestSubmit();
    });
  });

  // placed -> packed -> shipped -> out for delivery -> delivered, as a row of steps
  var STEPS = ["placed", "packed", "shipped", "out for delivery", "delivered"];
  function progress(status) {
    var at = STEPS.indexOf(String(status).toLowerCase());
    if (at === -1) return "";
    return '<ol class="steps" aria-label="Order progress">' + STEPS.map(function (step, i) {
      var state = i < at ? "done" : i === at ? "now" : "todo";
      return '<li class="' + state + '"' + (i === at ? ' aria-current="step"' : "") + '><span class="dot" aria-hidden="true"></span>' +
        '<span class="label">' + esc(step) + "</span></li>";
    }).join("") + "</ol>";
  }

  // ---- order lookup
  var looking = false;
  $("lookup-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (looking) return;
    var missing = missingFields();
    if (missing) {
      show(result, "error", "Please fill in the " + (missing === orderInput ? "order number" : "phone or email") + ".");
      missing.focus();
      return;
    }
    looking = true;
    busy(lookupBtn, true, "Checking…");
    show(result, "info", "Checking your order…");
    var slow = slowNotice(result, "Still checking. Our order system is slow right now, this can take up to 10 seconds…");

    post("/api/lookup", { order_number: orderInput.value, contact: contactInput.value }).then(function (r) {
      clearTimeout(slow);
      if (r.status === 200) {
        var b = r.body;
        show(result, "ok",
          '<p class="big">Status: <strong class="status">' + esc(b.status) + "</strong></p>" +
          progress(b.status) +
          "<p>Expected delivery: <strong>" + esc(b.expected_delivery) + "</strong>" +
          (friendlyDate(b.expected_delivery) ? " (" + esc(friendlyDate(b.expected_delivery)) + ")" : "") + "</p>");
      } else {
        show(result, r.status === 503 || r.status === 0 ? "warn" : "error", esc(problemText(r)));
      }
    }).finally(function () {
      looking = false;
      busy(lookupBtn, false, "Check my order");
    });
  });

  // ---- report a problem
  // One request id per message text: clicking twice, or trying again after a
  // timeout, sends the same id, so the server finds the same ticket.
  var pending = { text: null, id: null };
  var sending = false;

  $("report-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (sending) return;
    var missing = missingFields();
    if (missing) {
      show(sendResult, "error", "Please fill in the " + (missing === orderInput ? "order number" : "phone or email") + " at the top first.");
      missing.focus();
      return;
    }
    var text = message.value;
    if (!text.trim()) {
      show(sendResult, "error", "Please tell us what went wrong.");
      message.focus();
      return;
    }
    if (pending.text !== text) pending = { text: text, id: newRequestId() };

    sending = true;
    busy(sendBtn, true, "Sending…");
    show(sendResult, "info", "Sending your message…");
    var slow = slowNotice(sendResult, "Still sending. Please keep this page open, it can take up to 10 seconds…");

    post("/api/tickets", {
      order_number: orderInput.value,
      contact: contactInput.value,
      message: text,
      request_id: pending.id
    }).then(function (r) {
      clearTimeout(slow);
      if (r.status === 201) {
        show(sendResult, "ok",
          "<p><strong>Thank you, we have your message.</strong> Your ticket number is <strong>" + esc(r.body.ticket_id) + "</strong>.</p>" +
          "<p>We are emailing a confirmation to the email address on your order. It can take a few minutes.</p>");
        message.value = "";
        pending = { text: null, id: null };
        updateCount();
        saveDraft();
      } else {
        show(sendResult, r.status === 503 || r.status === 0 ? "warn" : "error", esc(problemText(r)));
      }
    }).finally(function () {
      sending = false;
      busy(sendBtn, false, "Send to our team");
    });
  });
})();
