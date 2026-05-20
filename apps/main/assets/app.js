// ─── Framing app — vanilla JS controllers ────────────────────────────────
// Three small modules, one per page: OrdersList, Intake, OrderDetail.
// All HTTP goes through the same-origin proxy: GETs read the projection,
// POSTs to /api/order/<action> proxy to grove-server.

const STAGE_LABELS = {
  intake: "Intake",
  cutting_materials: "Cutting materials",
  assembly: "Assembly",
  ready_for_pickup: "Ready for pickup",
  picked_up: "Picked up",
  cancelled: "Cancelled",
};

const GLASS_LABELS = {
  regular: "Regular glass",
  museum: "Museum glass",
  anti_glare: "Anti-glare glass",
  uv: "UV glass",
  conservation: "Conservation glass",
};

const MOUNTING_LABELS = {
  float: "Float",
  dry_mount: "Dry mount",
  hinge: "Hinge",
  other: "Other",
};

// All "active" stages — orders the shop is currently working on.
const ACTIVE_STAGES = ["intake", "cutting_materials", "assembly"];

// ─── small DOM helpers ───────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === false || v == null) continue;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

function toast(msg, kind = "ok") {
  const t = el("div", { class: "toast" + (kind === "error" ? " error" : "") }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

function fmtDims(w, h) {
  if (!w || !h) return "";
  return `${trimDecimal(w)}″ × ${trimDecimal(h)}″`;
}
function trimDecimal(d) {
  if (d == null) return "";
  const s = String(d);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

function fmtDate(s) {
  if (!s) return "";
  // ISO YYYY-MM-DD → "Jun 1"
  const [y, m, d] = s.split("-").map(Number);
  if (!m || !d) return s;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[m - 1]} ${d}`;
}

function fmtMoney(n) {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (Number.isNaN(v)) return String(n);
  return `$${v.toFixed(0)}`;
}

// ─── OrdersList controller (index.html) ──────────────────────────────────
const OrdersList = {
  filter: "active",

  async mount() {
    document.querySelectorAll(".filter-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        this.filter = tab.dataset.filter;
        this.render();
      });
    });
    await this.render();
  },

  async render() {
    const orders = await this.fetch();
    const filtered = this.applyFilter(orders);
    $("orders").innerHTML = "";
    $("order-count").textContent = filtered.length === 0
      ? "No orders here."
      : `${filtered.length} order${filtered.length === 1 ? "" : "s"}`;

    if (filtered.length === 0) {
      $("orders").appendChild(el("div", { class: "empty" },
        this.filter === "active"
          ? "No active orders. Tap + New to take one."
          : "Nothing here."
      ));
      return;
    }
    for (const o of filtered) $("orders").appendChild(this.card(o));
  },

  async fetch() {
    const res = await fetch("/api/orders");
    if (!res.ok) { toast("Failed to load orders", "error"); return []; }
    const json = await res.json();
    return json.orders || [];
  },

  applyFilter(orders) {
    if (this.filter === "all") return orders;
    if (this.filter === "active") return orders.filter(o => ACTIVE_STAGES.includes(o.stage));
    return orders.filter(o => o.stage === this.filter);
  },

  card(o) {
    const card = el("a", { class: "order-card", href: `/order.html?id=${encodeURIComponent(o.id)}` });
    card.innerHTML = `
      <div class="order-card-head">
        <div class="order-customer">${escapeHtml(o.customer_name)}</div>
        <span class="stage stage-${o.stage}">${STAGE_LABELS[o.stage] || o.stage}</span>
      </div>
      <div class="order-spec">${escapeHtml(o.frame_style || "—")} · ${fmtDims(o.frame_width_in, o.frame_height_in)}</div>
      <div class="order-meta">
        <span>Pickup: ${escapeHtml(fmtDate(o.estimated_pickup_date))}</span>
        <span>${escapeHtml(o.customer_phone || "")}</span>
      </div>
    `;
    return card;
  },
};

// ─── Intake controller (new.html) ────────────────────────────────────────
const Intake = {
  mount() {
    const photo = $("artwork_photo");
    if (photo) photo.addEventListener("change", e => this.previewPhoto(e));

    const form = $("intake-form");
    if (form) form.addEventListener("submit", e => this.submit(e));
  },

  previewPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target.result;
      $("artwork_photo_url").value = dataUrl;
      const img = $("photo-preview");
      img.src = dataUrl;
      img.hidden = false;
    };
    reader.readAsDataURL(file);
  },

  async submit(e) {
    e.preventDefault();
    const form = e.target;
    const data = new FormData(form);

    // Build the JSON body. Skip the raw file input — we send the data URL instead.
    const body = {};
    for (const [k, v] of data.entries()) {
      if (k === "artwork_photo") continue; // skip raw file
      if (v === "" && k !== "deposit_amount") continue; // skip blanks
      body[k] = v;
    }
    if (!body.deposit_amount) body.deposit_amount = "0";

    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";

    try {
      const res = await fetch("/api/order/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`${res.status}: ${t.slice(0, 200)}`);
      }
      const json = await res.json();
      toast("Order saved");
      // Land on the new order's detail page so Phil can review and the framer can pick up.
      setTimeout(() => { window.location.href = `/order.html?id=${json.record.id}`; }, 400);
    } catch (err) {
      console.error(err);
      toast("Save failed: " + err.message, "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Save order";
    }
  },
};

// ─── OrderDetail controller (order.html) ─────────────────────────────────
const OrderDetail = {
  order: null,

  async mount() {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) { $("order-main").textContent = "No order id given."; return; }
    await this.load(id);
  },

  async load(id) {
    const res = await fetch(`/api/order/${encodeURIComponent(id)}`);
    if (!res.ok) {
      $("order-main").innerHTML = `<p class="empty">Order not found.</p>`;
      return;
    }
    this.order = await res.json();
    this.render();
  },

  render() {
    const o = this.order;
    const main = $("order-main");
    main.innerHTML = "";

    main.appendChild(el("div", { class: "detail-head" },
      el("div", {},
        el("h1", { class: "page-title", style: "margin:0 0 4px" }, o.customer_name),
        el("div", { class: "page-sub", style: "margin:0" }, o.customer_phone)
      ),
      el("span", { class: `stage stage-${o.stage}` }, STAGE_LABELS[o.stage] || o.stage)
    ));

    if (o.artwork_photo_url) {
      main.appendChild(el("img", { class: "spec-photo", src: o.artwork_photo_url, alt: "Artwork" }));
    }

    if (o.notes) {
      const notes = el("div", { class: "notes-block" });
      notes.innerHTML = `<span class="lbl">Notes for the framer</span>${escapeHtml(o.notes)}`;
      main.appendChild(notes);
    }

    main.appendChild(this.specGrid(o));

    main.appendChild(this.stageActions(o));
  },

  specGrid(o) {
    const rows = [
      ["Frame style", o.frame_style],
      ["Color / finish", o.frame_color],
      ["Frame size", fmtDims(o.frame_width_in, o.frame_height_in)],
      ["Mat", o.mat_spec, true],
      ["Glass", GLASS_LABELS[o.glass_type] || o.glass_type],
      ["Mounting", MOUNTING_LABELS[o.mounting_type] || o.mounting_type],
      ["Artwork size", fmtDims(o.artwork_width_in, o.artwork_height_in)],
      ["Pickup target", fmtDate(o.estimated_pickup_date)],
      ["Deposit", fmtMoney(o.deposit_amount)],
      ["Final balance", o.final_balance == null ? "—" : fmtMoney(o.final_balance)],
    ];

    const grid = el("div", { class: "spec-grid" });
    for (const [label, value, block] of rows) {
      if (value == null || value === "") continue;
      const row = el("div", { class: "spec-row" });
      row.appendChild(el("span", { class: "spec-label" }, label));
      row.appendChild(el("span", { class: block ? "spec-value-block" : "spec-value" }, value));
      grid.appendChild(row);
    }
    return grid;
  },

  stageActions(o) {
    const wrap = el("div", { class: "stage-actions" });

    const advance = this.advanceAction(o.stage);
    if (advance) {
      wrap.appendChild(el("button", {
        class: "btn btn-primary btn-block btn-large",
        onclick: () => this.advance(o, advance),
      }, advance.label));
    }

    if (o.stage !== "picked_up" && o.stage !== "cancelled") {
      wrap.appendChild(el("button", {
        class: "btn btn-danger btn-block",
        onclick: () => this.cancel(o),
      }, "Cancel order"));
    }

    if (o.stage === "picked_up" || o.stage === "cancelled") {
      wrap.appendChild(el("div", { class: "page-sub" }, "This order is closed."));
    }

    return wrap;
  },

  advanceAction(stage) {
    switch (stage) {
      case "intake":             return { action: "start_cutting",  label: "Start cutting materials" };
      case "cutting_materials":  return { action: "start_assembly", label: "Materials cut, start assembly" };
      case "assembly":           return { action: "mark_ready",     label: "Mark ready for pickup" };
      case "ready_for_pickup":   return { action: "pick_up",        label: "Customer picked up", needsBalance: true };
      default:                   return null;
    }
  },

  async advance(o, { action, label, needsBalance }) {
    const body = { id: o.id };
    if (needsBalance) {
      const ans = prompt(`Final balance paid? ($)\nDeposit was ${fmtMoney(o.deposit_amount)}.`, "0");
      if (ans == null) return;
      body.final_balance = ans;
    }
    await this.post(action, body, `${label.split(",")[0]} done`);
  },

  async cancel(o) {
    if (!confirm(`Cancel order for ${o.customer_name}? This can't be undone.`)) return;
    const reason = prompt("Reason for cancelling? (optional)", "");
    await this.post("cancel", { id: o.id, reason: reason || null }, "Order cancelled");
  },

  async post(action, body, successMsg) {
    try {
      const res = await fetch(`/api/order/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`${res.status}: ${t.slice(0, 200)}`);
      }
      toast(successMsg);
      await this.load(this.order.id);
    } catch (err) {
      console.error(err);
      toast("Failed: " + err.message, "error");
    }
  },
};

// Expose for inline page scripts.
window.OrdersList = OrdersList;
window.Intake = Intake;
window.OrderDetail = OrderDetail;
