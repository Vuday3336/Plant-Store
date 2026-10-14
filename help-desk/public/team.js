// Team page. Logs in, lists tickets newest first, opens one, marks it resolved.
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var loginView = $("login-view");
  var ticketsView = $("tickets-view");
  var list = $("ticket-list");
  var dialog = $("ticket-dialog");
  var dialogBody = $("dialog-body");
  var resolveBtn = $("resolve");
  var resolveResult = $("resolve-result");
  var health = $("store-health");

  var tickets = [];
  var openTicketId = null;
  var lastFocus = null;
  var refreshTimer = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function when(ms) {
    if (!ms) return "";
    return new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function ago(ms) {
    var s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " days ago";
  }

  function api(method, url, body) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 15000);
    return fetch(url, {
      method: method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      signal: ctrl.signal
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) { return { status: res.status, body: b }; });
    }).catch(function () {
      return { status: 0, body: { message: "Cannot reach the help desk. Check your connection." } };
    }).finally(function () { clearTimeout(timer); });
  }

  // ---- views
  function showLogin(note) {
    clearInterval(refreshTimer);
    ticketsView.hidden = true;
    $("logout").hidden = true;
    loginView.hidden = false;
    var box = $("login-result");
    box.className = "result" + (note ? " info" : "");
    box.textContent = note || "";
    $("username").focus();
  }

  function showTickets() {
    loginView.hidden = true;
    ticketsView.hidden = false;
    $("logout").hidden = false;
    load();
    clearInterval(refreshTimer);
    // keep email states fresh; skip while a ticket is open so nothing jumps
    refreshTimer = setInterval(function () { if (!dialog.open) load(true); }, 15000);
  }

  // ---- email status in words
  function emailLine(e) {
    var what = e.kind === "confirmation" ? "Confirmation email" : "Resolved email";
    if (e.status === "sent") return { cls: "ok", text: what + ": sent " + when(e.sent_at) };
    if (e.status === "failed") return { cls: "error", text: what + ": could not be sent (" + (e.last_error || "unknown") + "). Contact the customer another way." };
    var t = what + ": waiting to send";
    if (e.attempts > 0) t += " (tried " + e.attempts + "×, store API: " + (e.last_error || "no answer") + "; it keeps trying)";
    return { cls: "warn", text: t };
  }

  function filterValue() {
    var el = document.querySelector('input[name="show"]:checked');
    return el ? el.value : "open";
  }

  function render() {
    var show = filterValue();
    var shown = tickets.filter(function (t) { return show === "all" || t.status === show; });
    var open = tickets.filter(function (t) { return t.status === "open"; }).length;
    $("summary").textContent = tickets.length + " tickets, " + open + " open. Showing " + shown.length + ", newest first.";

    if (!shown.length) {
      list.innerHTML = '<li class="empty">No ' + (show === "all" ? "" : show + " ") + "tickets.</li>";
      return;
    }
    list.innerHTML = shown.map(function (t) {
      var waiting = t.emails.some(function (e) { return e.status !== "sent"; });
      return '<li class="ticket ' + t.status + '">' +
        '<button type="button" class="ticket-open" data-id="' + t.id + '" aria-label="Open ticket ' + t.id + " for " + esc(t.order_number) + '">' +
          '<span class="t-top"><span class="t-id">#' + t.id + "</span>" +
          '<span class="badge ' + t.status + '">' + (t.status === "open" ? "Open" : "Resolved") + "</span>" +
          (waiting ? '<span class="badge warn" title="An email to this customer is still waiting">Email waiting</span>' : "") +
          '<span class="t-when">' + esc(when(t.created_at)) + " · " + esc(ago(t.created_at)) + "</span></span>" +
          '<span class="t-order">' + esc(t.order_number) + " · " + esc(t.customer_name || t.customer_email) + "</span>" +
          '<span class="t-msg">' + esc(t.message) + "</span>" +
        "</button></li>";
    }).join("");
  }

  function renderHealth(s) {
    if (!s) return;
    var down = s.last_error && (!s.last_ok || s.last_error > s.last_ok);
    if (down) {
      health.className = "result warn";
      health.textContent = "The store API is not answering (" + (s.last_error_detail || "error") + ", " + ago(s.last_error) +
        "). Customers see “try again in a minute”. " + s.emails_waiting + " email(s) are waiting and will be sent automatically when it is back.";
    } else if (s.emails_waiting > 0) {
      health.className = "result info";
      health.textContent = s.emails_waiting + " email(s) waiting to be sent.";
    } else {
      health.className = "result";
      health.textContent = "";
    }
  }

  function load(quiet) {
    if (!quiet) $("summary").textContent = "Loading tickets…";
    return api("GET", "/api/team/tickets").then(function (r) {
      if (r.status === 401) return showLogin("Your session ended. Please log in again.");
      if (r.status !== 200) {
        $("summary").textContent = "Could not load tickets: " + (r.body.message || "error") + " Use Refresh to try again.";
        return;
      }
      tickets = r.body.tickets;
      renderHealth(r.body.store_api);
      render();
    });
  }

  // ---- one ticket
  function renderDialog(t) {
    $("dialog-title").textContent = "Ticket #" + t.id + " · " + (t.status === "open" ? "Open" : "Resolved");
    dialogBody.innerHTML =
      "<dl class=\"facts\">" +
      "<dt>Order</dt><dd>" + esc(t.order_number) + "</dd>" +
      "<dt>Customer</dt><dd>" + esc(t.customer_name || "") + " &lt;" + esc(t.customer_email) + "&gt;</dd>" +
      "<dt>They entered</dt><dd>" + esc(t.contact) + "</dd>" +
      "<dt>Reported</dt><dd>" + esc(when(t.created_at)) + "</dd>" +
      (t.resolved_at ? "<dt>Resolved</dt><dd>" + esc(when(t.resolved_at)) + " by " + esc(t.resolved_by) + "</dd>" : "") +
      "</dl>" +
      '<h3>Message</h3><p class="message">' + esc(t.message) + "</p>" +
      "<h3>Emails to the customer</h3><ul class=\"emails\">" +
      t.emails.map(function (e) { var l = emailLine(e); return '<li class="' + l.cls + '">' + esc(l.text) + "</li>"; }).join("") +
      "</ul>";
    resolveBtn.hidden = t.status !== "open";
    resolveBtn.disabled = false;
    resolveBtn.textContent = "Mark resolved";
  }

  function openTicket(id) {
    var t = tickets.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    openTicketId = id;
    lastFocus = document.activeElement;
    resolveResult.className = "result";
    resolveResult.textContent = "";
    renderDialog(t);
    dialog.showModal();
    (resolveBtn.hidden ? $("close-dialog") : resolveBtn).focus();
  }

  function closeDialog() {
    dialog.close();
  }

  dialog.addEventListener("close", function () {
    openTicketId = null;
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  });

  list.addEventListener("click", function (ev) {
    var btn = ev.target.closest(".ticket-open");
    if (btn) openTicket(Number(btn.getAttribute("data-id")));
  });
  $("close-dialog").addEventListener("click", closeDialog);
  dialog.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { ev.preventDefault(); closeDialog(); }
  });
  dialog.addEventListener("click", function (ev) { if (ev.target === dialog) closeDialog(); });

  resolveBtn.addEventListener("click", function () {
    if (openTicketId == null || resolveBtn.disabled) return;
    var id = openTicketId;
    resolveBtn.disabled = true;
    resolveBtn.textContent = "Saving…";
    api("POST", "/api/team/tickets/" + id + "/resolve").then(function (r) {
      if (r.status === 401) { closeDialog(); return showLogin("Your session ended. Please log in again."); }
      if (r.status !== 200) {
        resolveBtn.disabled = false;
        resolveBtn.textContent = "Mark resolved";
        resolveResult.className = "result error";
        resolveResult.textContent = "Not saved: " + (r.body.message || "error") + " Try again.";
        return;
      }
      tickets = tickets.map(function (t) { return t.id === id ? r.body : t; });
      renderDialog(r.body);
      render();
      resolveResult.className = "result ok";
      resolveResult.textContent = r.body.already_resolved
        ? "Someone already resolved this ticket. The customer gets one email only."
        : "Resolved. The customer will get one email saying so.";
      $("close-dialog").focus();
    });
  });

  // Enter in a one-line field sends its form (some keyboards and assistive
  // tools do not trigger the browser's own implicit submit)
  Array.prototype.forEach.call(document.querySelectorAll('input[type="text"], input[type="password"]'), function (el) {
    el.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" || ev.isComposing || !el.form) return;
      ev.preventDefault();
      el.form.requestSubmit();
    });
  });

  // ---- login / logout / filters
  $("login-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var box = $("login-result");
    var btn = $("login");
    btn.disabled = true;
    box.className = "result info";
    box.textContent = "Logging in…";
    api("POST", "/api/team/login", { username: $("username").value, password: $("password").value }).then(function (r) {
      btn.disabled = false;
      if (r.status === 200) {
        $("password").value = "";
        box.textContent = "";
        showTickets();
        $("tickets-title").focus();
      } else {
        box.className = "result error";
        box.textContent = r.body.message || "Could not log in.";
        $("password").focus();
      }
    });
  });

  $("logout").addEventListener("click", function () {
    api("POST", "/api/team/logout").then(function () { tickets = []; list.innerHTML = ""; showLogin("You are logged out."); });
  });
  $("refresh").addEventListener("click", function () { load(); });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="show"]'), function (el) {
    el.addEventListener("change", render);
  });
  $("tickets-title").setAttribute("tabindex", "-1");

  // already logged in?
  api("GET", "/api/team/me").then(function (r) {
    if (r.status === 200) showTickets();
    else showLogin();
  });
})();
