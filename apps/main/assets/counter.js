// Framing app — iPad/desktop "counter" controllers.
// Digital version of Thomson's Art & Frame paper ticket FR-248-3.
// Three controllers:
//   CounterDashboard — 3-column board (active / ready / closed)
//   CounterIntake    — ticket-mirror intake with eight editors + signature
//   CounterOrder     — read-only ticket view + stage actions

const STAGE_LABELS = {
  intake: "Intake",
  cutting_materials: "Cutting materials",
  assembly: "Assembly",
  ready_for_pickup: "Ready for pickup",
  picked_up: "Picked up",
  cancelled: "Cancelled",
};

const GLASS_LABELS = {
  regular: "Regular",
  non_glare: "Non-glare",
  plexi: "Plexi",
  acrylic: "Acrylic",
  mirror: "Mirror",
};

const MOUNT_LABELS = {
  dry: "Dry",
  wet: "Wet",
  museum: "Museum",
};

const HANGER_LABELS = {
  wire: "Wire",
  easel: "Easel",
  sawtooth: "Sawtooth",
};

const SERVICE_LABELS = {
  service_stretch: "Stretch",
  service_repair: "Repair",
  service_block: "Block",
  service_fitting: "Fitting",
};

const ACTIVE_STAGES = ["intake", "cutting_materials", "assembly"];

// Shop config — name, address, ticket_seq_start, tax_rate, twilio_from.
// Fetched from /api/shop once per page load and cached here so the
// intake renderer can read it synchronously.
let SHOP = null;

async function loadShop() {
  if (SHOP) return SHOP;
  try {
    const res = await fetch("/api/shop");
    if (res.ok) SHOP = await res.json();
  } catch (err) {
    console.warn("shop fetch failed", err);
  }
  return SHOP || {};
}

// Authorization paragraph rendered verbatim above the signature pad.
const AUTH_TEXT =
  "I hereby authorize the above work to be done, with any materials or " +
  "supplies required. Recognizing that extreme care will be taken with the " +
  "article(s) being framed, I agree to assume all risks and liabilities. " +
  "I understand the shop is not responsible for work left over 30 days.";

// Quick-pick presets. v1 hardcoded. Swap after Phil reviews.
const FRAME_MOLDING_PRESETS = [
  { label: "Larson Brittney 1.5\"", molding_no: "LJ-372181", price: "2.85" },
  { label: "Roma Tabacchino",        molding_no: "RM-440-110", price: "3.20" },
  { label: "Studio Bronze 1\"",      molding_no: "ST-1011",  price: "2.10" },
  { label: "Modern Black 1\"",       molding_no: "MB-100",   price: "1.80" },
  { label: "Vintage Gold ornate",    molding_no: "VG-301",   price: "4.40" },
];
const LINER_PRESETS = [
  { label: "Linen oyster",  liner_no: "LN-OY", price: "1.85" },
  { label: "Linen ivory",   liner_no: "LN-IV", price: "1.85" },
  { label: "Suede charcoal", liner_no: "SD-CH", price: "2.10" },
];
const MAT_COLOR_PRESETS = ["Ivory", "White", "Cream", "Black core", "Sage", "Charcoal", "Burgundy", "Navy"];

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

// livePoll — generic "this view stays in sync with the DB" helper.
// Polls `fetcher()` every intervalMs; calls applier(data) only when the
// payload changes; skips the tick when the tab is hidden so a backgrounded
// browser doesn't burn cycles. onSync(kind) fires after every successful
// fetch: "changed" when the payload differed (callsite re-rendered), "same"
// when it matched. Cleans itself up on beforeunload.
function livePoll(fetcher, applier, opts = {}) {
  const intervalMs = opts.intervalMs || 5000;
  const onSync = opts.onSync || (() => {});
  let lastHash = null;
  let inflight = false;
  const tick = async () => {
    if (document.hidden) return;
    if (inflight) return;
    inflight = true;
    try {
      const data = await fetcher();
      const hash = JSON.stringify(data);
      const changed = hash !== lastHash;
      if (changed) {
        lastHash = hash;
        applier(data);
      }
      onSync(changed ? "changed" : "same");
    } catch (err) {
      // Transient errors don't kill the loop; the view keeps the last good
      // render. Log so the console shows what's happening during debug.
      console.warn("livePoll fetch failed:", err);
    } finally {
      inflight = false;
    }
  };
  tick();
  const handle = setInterval(tick, intervalMs);
  window.addEventListener("beforeunload", () => clearInterval(handle));
  return handle;
}

// SyncIndicator — small "Synced just now / 8s ago" pill rendered in a
// page header. Updates a label every second and flashes a green dot when
// new data lands. Pure DOM: takes an existing host element and writes
// into it.
function mountSyncIndicator(host) {
  if (!host) return { onSync: () => {} };
  host.innerHTML = `<span class="sync-dot"></span><span class="sync-label">Connecting…</span>`;
  const dot = host.querySelector(".sync-dot");
  const label = host.querySelector(".sync-label");
  let lastSyncMs = null;
  const tick = () => {
    if (lastSyncMs == null) return;
    const age = Math.round((Date.now() - lastSyncMs) / 1000);
    label.textContent = age < 3 ? "Synced just now" : `Synced ${age}s ago`;
  };
  setInterval(tick, 1000);
  return {
    onSync: (kind) => {
      lastSyncMs = Date.now();
      tick();
      if (kind === "changed") {
        dot.classList.remove("flash");
        // force reflow so the animation restarts on rapid updates
        void dot.offsetWidth;
        dot.classList.add("flash");
      }
    },
  };
}

function trimDecimal(d) {
  if (d == null || d === "") return "";
  const s = String(d);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

function fmtMoney(n) {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (Number.isNaN(v)) return String(n);
  return `$${v.toFixed(2)}`;
}

function fmtDate(s) {
  if (!s) return "";
  const [y, m, d] = s.split("-").map(Number);
  if (!m || !d) return s;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[m - 1]} ${d}`;
}

function fmtDateTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    const hh = ((h + 11) % 12) + 1;
    return `${months[d.getMonth()]} ${d.getDate()} · ${hh}:${String(m).padStart(2, "0")} ${ampm}`;
  } catch { return iso; }
}

function todayISO(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Parse "16 x 20", "16.5 x 20", "16-1/4 x 20" into [w, h] inches.
// Returns null if it can't be parsed.
function parseSize(str) {
  if (!str) return null;
  const cleaned = String(str).toLowerCase().replace(/[″"in]/g, "").trim();
  const parts = cleaned.split(/\s*x\s*/);
  if (parts.length !== 2) return null;
  const parseDim = (s) => {
    s = s.trim();
    if (!s) return null;
    // "16-1/4" or "1/4"
    const mixed = s.match(/^(\d+)\s*[- ]\s*(\d+)\s*\/\s*(\d+)$/);
    if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (frac) return Number(frac[1]) / Number(frac[2]);
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };
  const w = parseDim(parts[0]);
  const h = parseDim(parts[1]);
  if (w == null || h == null || w <= 0 || h <= 0) return null;
  return [w, h];
}

function feetFromSize(sizeStr) {
  const wh = parseSize(sizeStr);
  if (!wh) return null;
  const [w, h] = wh;
  return Math.round((2 * (w + h) / 12) * 100) / 100;
}

function num(v, fallback = 0) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Build a full-state update body from an existing order record so the
// Grove update event doesn't null out fields not in the request.
// (Grove replaces fields with null on update; that fails invariants like
// `record.balance_due >= 0`. So we always echo back the full state.)
function fullOrderBody(o) {
  const body = {};
  const strFields = [
    "customer_name", "customer_phone", "customer_address", "customer_zip",
    "customer_email", "date_received", "date_promised", "description_of_item",
    "frame_size", "frame_molding_no",
    "liner_size", "liner_no",
    "mat1_type", "mat1_color", "mat2_type", "mat2_color",
    "glass_kind", "mount_kind", "mount_backer_type", "hanger_kind",
    "misc_supplies", "special_instructions",
    "customer_signature_png", "customer_signed_at",
    "artwork_photo_url",
  ];
  for (const k of strFields) {
    if (o[k] != null && o[k] !== "") body[k] = String(o[k]);
  }
  const decFields = [
    "declared_value",
    "frame_feet", "frame_price_per_foot", "frame_amount",
    "liner_feet", "liner_price_per_foot", "liner_amount",
    "mat1_margin_top_in", "mat1_margin_sides_in", "mat1_margin_bottom_in", "mat1_amount",
    "mat2_margin_top_in", "mat2_margin_sides_in", "mat2_margin_bottom_in", "mat2_amount",
    "glass_amount", "mount_amount", "hanger_amount",
    "services_amount", "misc_supplies_amount",
    "subtotal", "tax_amount", "total", "deposit_amount", "balance_due",
  ];
  for (const k of decFields) {
    if (o[k] != null && o[k] !== "") body[k] = String(o[k]);
  }
  const boolFields = ["service_stretch", "service_repair", "service_block", "service_fitting"];
  for (const k of boolFields) {
    body[k] = !!o[k];
  }
  return body;
}

// ===================================================================
// CounterDashboard
// ===================================================================
const CounterDashboard = {
  async mount() {
    const indicator = mountSyncIndicator($("sync-indicator"));
    livePoll(
      () => this.fetch(),
      (orders) => this.render(orders),
      { onSync: indicator.onSync },
    );
  },

  render(orders) {
    const active = orders.filter(o => ACTIVE_STAGES.includes(o.stage));
    const ready  = orders.filter(o => o.stage === "ready_for_pickup");
    const closed = orders.filter(o => o.stage === "picked_up" || o.stage === "cancelled");

    this.fillColumn("col-active",  active,  "No active orders. Tap + New to take one.");
    this.fillColumn("col-ready",   ready,   "Nothing waiting for pickup.");
    this.fillColumn("col-closed",  closed,  "No recently closed orders.");

    $("count-active").textContent = active.length;
    $("count-ready").textContent  = ready.length;
    $("count-closed").textContent = closed.length;
  },

  async fetch() {
    const res = await fetch("/api/orders");
    if (!res.ok) { toast("Failed to load orders", "error"); return []; }
    const json = await res.json();
    return json.orders || [];
  },

  fillColumn(id, list, emptyMsg) {
    const wrap = $(id);
    wrap.innerHTML = "";
    if (list.length === 0) {
      wrap.appendChild(el("div", { class: "empty" }, emptyMsg));
      return;
    }
    for (const o of list) wrap.appendChild(this.card(o));
  },

  card(o) {
    const card = el("a", {
      class: "order-card",
      href: `/counter/order.html?id=${encodeURIComponent(o.id)}`,
    });
    const thumb = o.artwork_photo_url
      ? el("div", { class: "order-card-thumb", style: `background-image:url('${o.artwork_photo_url}')` })
      : el("div", { class: "order-card-thumb no-photo" }, "\u{1F5BC}");
    const body = el("div", { class: "order-card-body" });
    body.innerHTML = `
      <div class="order-card-head">
        <div>
          <div class="order-ticket-no">#${escapeHtml(o.ticket_no || "—")}</div>
          <div class="order-customer">${escapeHtml(o.customer_name)}</div>
        </div>
        <span class="stage stage-${o.stage}">${STAGE_LABELS[o.stage] || o.stage}</span>
      </div>
      <div class="order-spec">${escapeHtml(o.frame_size || "—")} · ${escapeHtml(o.description_of_item || "")}</div>
      <div class="order-meta">Promised ${escapeHtml(fmtDate(o.date_promised))} · ${escapeHtml(o.customer_phone || "")}</div>
    `;
    card.append(thumb, body);
    return card;
  },
};

// ===================================================================
// CounterIntake — ticket-mirror layout, eight editors, signature pad
// ===================================================================
const CounterIntake = {
  state: null,
  rootEl: null,
  footerSummaryEl: null,
  saveBtnEl: null,
  scanBtnEl: null,
  scanInputEl: null,
  // Memoized DOM nodes for partial re-renders.
  ticketEl: null,
  editorEl: null,

  async mount() {
    // Load shop config before building blank state so tax_rate is correct
    // on the first render.
    await loadShop();
    this.state = this.blankState();
    this.rootEl = $("intake-root");
    this.footerSummaryEl = $("footer-summary");
    this.saveBtnEl = $("save-btn");
    this.scanBtnEl = $("scan-btn");
    this.scanInputEl = $("scan-input");
    this.saveBtnEl.addEventListener("click", () => this.submit());
    if (this.scanBtnEl) {
      this.scanBtnEl.addEventListener("click", () => this.startScan());
    }
    if (this.scanInputEl) {
      this.scanInputEl.addEventListener("change", (e) => this.onScanFile(e));
    }
    this.fetchNextTicketNo();
    this.render();
  },

  blankState() {
    return {
      next_ticket_no: "",

      customer_name: "", customer_phone: "",
      customer_address: "", customer_zip: "", customer_email: "",

      date_received: todayISO(0),
      date_promised: todayISO(14),

      description_of_item: "",
      declared_value: "",

      frame_size: "", frame_molding_no: "",
      frame_feet: "", frame_price_per_foot: "", frame_amount: "",

      liner_size: "", liner_no: "",
      liner_feet: "", liner_price_per_foot: "", liner_amount: "",

      mat1_type: "", mat1_color: "",
      mat1_margin_top_in: "", mat1_margin_sides_in: "", mat1_margin_bottom_in: "",
      mat1_amount: "",

      mat2_type: "", mat2_color: "",
      mat2_margin_top_in: "", mat2_margin_sides_in: "", mat2_margin_bottom_in: "",
      mat2_amount: "",

      glass_kind: "regular",
      glass_amount: "",

      mount_kind: "dry",
      mount_backer_type: "",
      mount_amount: "",

      hanger_kind: "wire",
      hanger_amount: "",

      service_stretch: false, service_repair: false,
      service_block: false, service_fitting: false,
      services_amount: "",

      misc_supplies: "",
      misc_supplies_amount: "",

      special_instructions: "",

      tax_rate: num(SHOP?.tax_rate, 0),
      deposit_amount: "",

      customer_signature_png: "",
      customer_signed_at: "",

      artwork_photo_url: "",

      // UI
      active_editor: "frame",
      mat_tab: "mat1",
    };
  },

  async fetchNextTicketNo() {
    try {
      const res = await fetch("/api/_next_ticket");
      if (!res.ok) return;
      const json = await res.json();
      this.state.next_ticket_no = json.ticket_no || "";
      // Only the header needs to update; do a full ticket-pane render.
      this.renderTicket();
    } catch (err) {
      console.warn("ticket_no fetch failed", err);
    }
  },

  set(patch, opts = {}) {
    Object.assign(this.state, patch);
    if (opts.skipRender) return;
    if (opts.partial === "ticket") {
      this.renderTicket();
      this.refreshFooter();
      return;
    }
    if (opts.partial === "editor") {
      this.renderEditor();
      return;
    }
    this.render();
  },

  // --------- Pricing math ---------
  recomputeAmounts() {
    const s = this.state;
    // Frame amount from feet * $/ft when both are present.
    const ff = num(s.frame_feet), fp = num(s.frame_price_per_foot);
    if (ff > 0 && fp > 0) s.frame_amount = String(round2(ff * fp));
    const lf = num(s.liner_feet), lp = num(s.liner_price_per_foot);
    if (lf > 0 && lp > 0) s.liner_amount = String(round2(lf * lp));
  },

  totals() {
    const s = this.state;
    const subtotal = round2(
      num(s.frame_amount) + num(s.liner_amount) +
      num(s.mat1_amount) + num(s.mat2_amount) +
      num(s.glass_amount) + num(s.mount_amount) +
      num(s.hanger_amount) + num(s.services_amount) +
      num(s.misc_supplies_amount)
    );
    const tax = round2(subtotal * num(s.tax_rate));
    const total = round2(subtotal + tax);
    const deposit = round2(num(s.deposit_amount));
    const balance = round2(total - deposit);
    return { subtotal, tax, total, deposit, balance };
  },

  canSave() {
    const s = this.state;
    return (
      s.customer_name.trim() &&
      s.customer_phone.trim() &&
      s.date_received && s.date_promised &&
      s.description_of_item.trim() &&
      s.frame_size.trim()
    );
  },

  // --------- Render ---------
  render() {
    this.rootEl.innerHTML = "";
    this.ticketEl = el("div", { class: "ticket" });
    this.editorEl = el("div", { class: "editor" });
    this.rootEl.append(this.ticketEl, this.editorEl);
    this.renderTicket();
    this.renderEditor();
    this.refreshFooter();
  },

  refreshFooter() {
    const t = this.totals();
    this.footerSummaryEl.innerHTML =
      `Total <strong>${fmtMoney(t.total)}</strong> · balance <strong>${fmtMoney(t.balance)}</strong>`;
    this.saveBtnEl.disabled = !this.canSave();
  },

  // ---- Left pane (ticket) ----
  renderTicket() {
    if (!this.ticketEl) return;
    // Preserve scroll positions across re-renders: both the outer ticket
    // pane scroll (used on iPad landscape where total content exceeds the
    // viewport) and the inner line-items scroll.
    const ticketScrollTop = this.ticketEl.scrollTop;
    const oldScroll = this.ticketEl.querySelector(".ticket-lines-scroll");
    const linesScrollTop = oldScroll ? oldScroll.scrollTop : 0;
    this.ticketEl.innerHTML = "";
    const s = this.state;
    const t = this.totals();

    // Paper-style header — values come from shop.json via /api/shop.
    const shopName = (SHOP && SHOP.shop_name) || "Custom framing";
    const shopAddr = (SHOP && SHOP.shop_address) || "";
    const shopPhone = (SHOP && SHOP.shop_phone) || "";
    const shopEmail = (SHOP && SHOP.shop_email) || "";
    const contactLine = [shopPhone, shopEmail].filter(Boolean).join(" · ");
    const head = el("div", { class: "ticket-header" });
    head.innerHTML = `
      <div class="ticket-header-name">${escapeHtml(shopName)}</div>
      <div class="ticket-header-addr">
        ${escapeHtml(shopAddr)}${contactLine ? "<br>" + escapeHtml(contactLine) : ""}
      </div>
      <div class="ticket-header-meta">
        <span>TICKET #${escapeHtml(s.next_ticket_no || "—")}</span>
        <span>${escapeHtml(todayISO(0))}</span>
      </div>
    `;
    this.ticketEl.appendChild(head);

    // Header row 1: phone | date received | date promised
    const row1 = this.fieldRow(["customer"], "ticket-cells-3", [
      ["PHONE",         s.customer_phone || "tap to add", !s.customer_phone],
      ["DATE RECEIVED", s.date_received ? fmtDate(s.date_received) : "tap to add", !s.date_received],
      ["DATE PROMISED", s.date_promised ? fmtDate(s.date_promised) : "tap to add", !s.date_promised],
    ]);
    this.ticketEl.appendChild(row1);

    // Name row
    const row2 = this.fieldRow(["customer"], "ticket-cells-1", [
      ["NAME", s.customer_name || "tap to add", !s.customer_name],
    ]);
    this.ticketEl.appendChild(row2);

    // Address + zip row
    const addrParts = [s.customer_address, s.customer_email].filter(Boolean).join(" · ");
    const row3 = this.fieldRow(["customer"], "ticket-cells-2", [
      ["ADDRESS", addrParts || "tap to add", !addrParts],
      ["ZIP CODE", s.customer_zip || "tap to add", !s.customer_zip],
    ]);
    this.ticketEl.appendChild(row3);

    // Description + declared value
    const row4 = this.fieldRow(["description"], "ticket-cells-2", [
      ["DESCRIPTION OF ITEM TO BE FRAMED", s.description_of_item || "tap to add", !s.description_of_item],
      ["DECLARED VALUE",
        s.declared_value !== "" && s.declared_value != null ? fmtMoney(s.declared_value) : "tap to add",
        s.declared_value === "" || s.declared_value == null],
    ]);
    // photo thumbnail inline with description (if any)
    if (s.artwork_photo_url) {
      const thumb = el("div", { class: "editor-photo-thumb", style: `background-image:url('${s.artwork_photo_url}')` });
      thumb.style.width = "36px";
      thumb.style.height = "36px";
      thumb.style.marginRight = "6px";
      const descCell = row4.querySelector(".ticket-cell");
      if (descCell) descCell.prepend(thumb);
    }
    this.ticketEl.appendChild(row4);

    // Line items — header stays pinned, rows scroll internally.
    const lines = el("div", { class: "ticket-lines" });
    const head2 = el("div", { class: "ticket-lines-head" },
      el("div", {}, "ITEM"),
      el("div", {}, "DESCRIPTION"),
      el("div", {}, "AMOUNT"),
    );
    lines.appendChild(head2);
    const scroll = el("div", { class: "ticket-lines-scroll" });
    scroll.appendChild(this.lineRow("frame", "FRAME", this.descFrame(), s.frame_amount, this.frameEmpty()));
    scroll.appendChild(this.lineRow("liner", "LINER", this.descLiner(), s.liner_amount, this.linerEmpty()));
    scroll.appendChild(this.lineRow("mat", "MAT #1", this.descMat(1), s.mat1_amount, this.matEmpty(1)));
    scroll.appendChild(this.lineRow("mat", "MAT #2", this.descMat(2), s.mat2_amount, this.matEmpty(2), { matTab: "mat2" }));
    scroll.appendChild(this.lineRow("glass", "GLASS", this.descGlass(), s.glass_amount, false));
    scroll.appendChild(this.lineRow("mount", "MOUNT", this.descMount(), s.mount_amount, false));
    scroll.appendChild(this.lineRow("hanger", "HANGER", this.descHanger(), s.hanger_amount, false));
    scroll.appendChild(this.lineRow("services", "MISC. SERVICES", this.descServices(), s.services_amount, this.servicesEmpty()));
    scroll.appendChild(this.lineRow("supplies", "MISC. SUPPLIES", s.misc_supplies || "", s.misc_supplies_amount, !s.misc_supplies));
    lines.appendChild(scroll);
    this.ticketEl.appendChild(lines);

    // Special instructions
    const si = el("div", { class: "ticket-special" + (s.active_editor === "notes" ? " is-active" : "") },
      el("div", { class: "ticket-special-label" }, "SPECIAL INSTRUCTIONS"),
      el("div", { class: "ticket-special-value" + (s.special_instructions ? "" : " dim") },
        s.special_instructions || "tap to add"),
    );
    si.addEventListener("click", () => this.setEditor("notes"));
    this.ticketEl.appendChild(si);

    // Totals
    this.ticketEl.appendChild(this.totalsBlock(t));

    // Authorization + signature
    this.ticketEl.appendChild(this.authBlock());

    this.ticketEl.scrollTop = ticketScrollTop;
    const newScroll = this.ticketEl.querySelector(".ticket-lines-scroll");
    if (newScroll) newScroll.scrollTop = linesScrollTop;
  },

  fieldRow(editors, cellsClass, cells) {
    const editor = editors[0];
    const row = el("div", {
      class: "ticket-field-row " + cellsClass +
        (this.state.active_editor === editor ? " is-active" : ""),
    });
    row.addEventListener("click", () => this.setEditor(editor));
    for (const [label, value, isDim] of cells) {
      const cell = el("div", { class: "ticket-cell" },
        el("div", { class: "ticket-cell-label" }, label),
        el("div", { class: "ticket-cell-value" + (isDim ? " dim" : "") }, value),
      );
      row.appendChild(cell);
    }
    return row;
  },

  lineRow(editor, label, desc, amount, isEmpty, opts = {}) {
    const cls = "ticket-line"
      + (this.state.active_editor === editor && (opts.matTab ? this.state.mat_tab === opts.matTab : true) ? " is-active" : "")
      + (isEmpty ? " is-empty" : "");
    const row = el("div", { class: cls });
    row.addEventListener("click", () => {
      // Use setEditor (not this.set()) so the click doesn't destroy and
      // recreate the .ticket wrapper, which would reset both scroll positions
      // (the outer ticket scroll AND the inner line-items scroll).
      if (opts.matTab) this.state.mat_tab = opts.matTab;
      else if (editor === "mat") this.state.mat_tab = "mat1";
      this.setEditor(editor);
    });
    row.appendChild(el("div", { class: "ticket-line-label" }, label));
    const descEl = el("div", { class: "ticket-line-desc" });
    if (desc instanceof Node) descEl.appendChild(desc);
    else descEl.innerHTML = desc || "<span class=\"subline\">tap to add</span>";
    row.appendChild(descEl);
    const amt = el("div", { class: "ticket-line-amount" },
      amount !== "" && amount != null && num(amount) !== 0 ? fmtMoney(amount) : "—");
    row.appendChild(amt);
    return row;
  },

  descFrame() {
    const s = this.state;
    const parts = [];
    if (s.frame_size) parts.push(`<strong>${escapeHtml(s.frame_size)}</strong>`);
    if (s.frame_molding_no) parts.push(escapeHtml(s.frame_molding_no));
    const sub = [];
    if (s.frame_feet) sub.push(`${trimDecimal(s.frame_feet)} ft`);
    if (s.frame_price_per_foot) sub.push(`@ ${fmtMoney(s.frame_price_per_foot)}/ft`);
    let html = parts.join(" · ") || "tap to add";
    if (sub.length) html += `<span class="subline">${sub.join(" · ")}</span>`;
    return html;
  },
  frameEmpty() { const s = this.state; return !s.frame_size && !s.frame_molding_no; },

  descLiner() {
    const s = this.state;
    const parts = [];
    if (s.liner_size) parts.push(`<strong>${escapeHtml(s.liner_size)}</strong>`);
    if (s.liner_no) parts.push(escapeHtml(s.liner_no));
    const sub = [];
    if (s.liner_feet) sub.push(`${trimDecimal(s.liner_feet)} ft`);
    if (s.liner_price_per_foot) sub.push(`@ ${fmtMoney(s.liner_price_per_foot)}/ft`);
    let html = parts.join(" · ") || "—";
    if (sub.length) html += `<span class="subline">${sub.join(" · ")}</span>`;
    return html;
  },
  linerEmpty() { const s = this.state; return !s.liner_size && !s.liner_no; },

  descMat(n) {
    const s = this.state;
    const t = s[`mat${n}_type`];
    const c = s[`mat${n}_color`];
    const top = s[`mat${n}_margin_top_in`];
    const sd = s[`mat${n}_margin_sides_in`];
    const bot = s[`mat${n}_margin_bottom_in`];
    const parts = [];
    if (t) parts.push(`<strong>${escapeHtml(t)}</strong>`);
    if (c) parts.push(escapeHtml(c));
    const margins = [];
    if (top) margins.push(`T ${trimDecimal(top)}"`);
    if (sd) margins.push(`S ${trimDecimal(sd)}"`);
    if (bot) margins.push(`B ${trimDecimal(bot)}"`);
    let html = parts.join(" · ") || "—";
    if (margins.length) html += `<span class="subline">${margins.join(" · ")}</span>`;
    return html;
  },
  matEmpty(n) {
    const s = this.state;
    return !s[`mat${n}_type`] && !s[`mat${n}_color`]
      && !s[`mat${n}_margin_top_in`] && !s[`mat${n}_margin_sides_in`] && !s[`mat${n}_margin_bottom_in`];
  },

  descGlass() {
    return `<strong>${escapeHtml(GLASS_LABELS[this.state.glass_kind] || this.state.glass_kind)}</strong>`;
  },
  descMount() {
    const s = this.state;
    let html = `<strong>${escapeHtml(MOUNT_LABELS[s.mount_kind] || s.mount_kind)}</strong>`;
    if (s.mount_backer_type) html += `<span class="subline">backer: ${escapeHtml(s.mount_backer_type)}</span>`;
    return html;
  },
  descHanger() {
    return `<strong>${escapeHtml(HANGER_LABELS[this.state.hanger_kind] || this.state.hanger_kind)}</strong>`;
  },
  descServices() {
    const s = this.state;
    const chips = [];
    for (const [key, label] of Object.entries(SERVICE_LABELS)) {
      if (s[key]) chips.push(`<span class="chip">${escapeHtml(label)}</span>`);
    }
    return chips.length ? chips.join("") : "—";
  },
  servicesEmpty() {
    const s = this.state;
    return !s.service_stretch && !s.service_repair && !s.service_block && !s.service_fitting;
  },

  totalsBlock(t) {
    const wrap = el("div", { class: "ticket-totals" });
    wrap.appendChild(el("div", { class: "ticket-totals-spacer" }));
    const stack = el("div", { class: "ticket-totals-stack" });
    stack.appendChild(this.totalRow("SUB-TOTAL", fmtMoney(t.subtotal)));
    // Tax row with editable rate
    const taxRow = el("div", { class: "ticket-totals-row" });
    const labelWrap = el("div", {},
      el("span", { class: "ticket-totals-label" }, "TAX"),
      el("span", { class: "ticket-totals-rate" }, `(${(num(this.state.tax_rate) * 100).toFixed(3).replace(/\.?0+$/, "")}%)`),
    );
    taxRow.appendChild(labelWrap);
    taxRow.appendChild(el("div", { class: "ticket-totals-value" }, fmtMoney(t.tax)));
    taxRow.addEventListener("click", () => this.openTaxRateModal());
    taxRow.classList.add("tappable");
    stack.appendChild(taxRow);

    stack.appendChild(this.totalRow("TOTAL", fmtMoney(t.total), "is-total"));

    // Deposit inline-editable
    const depRow = el("div", { class: "ticket-totals-row" });
    depRow.appendChild(el("span", { class: "ticket-totals-label" }, "DEPOSIT"));
    const depInput = el("input", {
      class: "ticket-totals-inline-input",
      type: "text",
      inputmode: "decimal",
      value: this.state.deposit_amount || "",
      placeholder: "0.00",
    });
    depInput.addEventListener("input", (e) => {
      this.state.deposit_amount = e.target.value;
      // Update totals values without re-render to keep focus.
      this.updateTotalsDOM();
      this.refreshFooter();
    });
    depInput.addEventListener("click", (e) => e.stopPropagation());
    depRow.appendChild(depInput);
    stack.appendChild(depRow);

    stack.appendChild(this.totalRow("BALANCE DUE", fmtMoney(t.balance), "is-balance"));

    wrap.appendChild(stack);
    return wrap;
  },

  totalRow(label, value, extraClass = "") {
    const row = el("div", { class: "ticket-totals-row " + extraClass });
    row.appendChild(el("span", { class: "ticket-totals-label" }, label));
    row.appendChild(el("span", { class: "ticket-totals-value" }, value));
    return row;
  },

  updateTotalsDOM() {
    // Re-render just the totals block so the live deposit input keeps focus.
    if (!this.ticketEl) return;
    const oldBlock = this.ticketEl.querySelector(".ticket-totals");
    if (!oldBlock) return;
    const t = this.totals();
    const next = this.totalsBlock(t);
    // Preserve focus on the deposit input by transplanting it.
    const oldInput = oldBlock.querySelector(".ticket-totals-inline-input");
    if (oldInput && document.activeElement === oldInput) {
      const newInput = next.querySelector(".ticket-totals-inline-input");
      newInput.value = oldInput.value;
      oldBlock.replaceWith(next);
      newInput.focus();
      // Move caret to end.
      const v = newInput.value;
      newInput.setSelectionRange(v.length, v.length);
    } else {
      oldBlock.replaceWith(next);
    }
  },

  authBlock() {
    const s = this.state;
    const wrap = el("div", { class: "ticket-auth" + (s.active_editor === "signature" ? " is-active" : "") });
    wrap.appendChild(el("div", { class: "ticket-auth-text" }, AUTH_TEXT));
    const sig = el("div", { class: "ticket-auth-sig" });
    if (s.customer_signature_png) {
      sig.appendChild(el("img", { src: s.customer_signature_png, alt: "Customer signature" }));
      if (s.customer_signed_at) {
        sig.appendChild(el("div", { class: "ticket-auth-sig-time" }, "Signed " + fmtDateTime(s.customer_signed_at)));
      }
    } else {
      sig.appendChild(el("div", { class: "ticket-auth-sig-placeholder" }, "Customer signature — tap to sign"));
    }
    wrap.appendChild(sig);
    wrap.addEventListener("click", () => this.openSignaturePad());
    return wrap;
  },

  setEditor(name) {
    this.state.active_editor = name;
    if (name === "mat" && !["mat1", "mat2"].includes(this.state.mat_tab)) {
      this.state.mat_tab = "mat1";
    }
    this.renderTicket();
    this.renderEditor();
  },

  // ---- Right pane (editor) ----
  renderEditor() {
    if (!this.editorEl) return;
    const scroll = this.editorEl.scrollTop;
    this.editorEl.innerHTML = "";
    const map = {
      customer: () => this.editCustomer(),
      description: () => this.editDescription(),
      frame: () => this.editFrame(),
      liner: () => this.editLiner(),
      mat: () => this.editMat(),
      glass: () => this.editGlass(),
      mount: () => this.editMount(),
      hanger: () => this.editHanger(),
      services: () => this.editServices(),
      supplies: () => this.editSupplies(),
      notes: () => this.editNotes(),
      signature: () => this.editSignaturePlaceholder(),
    };
    const fn = map[this.state.active_editor] || map.frame;
    fn();
    this.editorEl.scrollTop = scroll;
  },

  editorHead(title, sub) {
    const head = el("div", { class: "editor-head" });
    head.appendChild(el("h2", { class: "editor-title" }, title));
    if (sub) head.appendChild(el("div", { class: "editor-sub" }, sub));
    this.editorEl.appendChild(head);
  },

  textField(label, key, opts = {}) {
    const wrap = el("div", { class: "editor-field" });
    wrap.appendChild(el("div", { class: "editor-field-label" }, label));
    const input = el(opts.textarea ? "textarea" : "input", {
      class: opts.textarea ? "editor-textarea" : "editor-input",
      type: opts.type || "text",
      inputmode: opts.inputmode,
      placeholder: opts.placeholder || "",
      maxlength: opts.maxlength,
    });
    input.value = this.state[key] ?? "";
    input.addEventListener("input", (e) => {
      this.state[key] = e.target.value;
      this.renderTicket();
      this.refreshFooter();
      if (opts.onInput) opts.onInput(e);
    });
    if (opts.onBlur) input.addEventListener("blur", opts.onBlur);
    wrap.appendChild(input);
    return wrap;
  },

  numField(label, key, opts = {}) {
    return this.textField(label, key, {
      ...opts,
      type: "text",
      inputmode: "decimal",
    });
  },

  amountField(key, label = "AMOUNT $") {
    return this.numField(label, key, { placeholder: "0.00" });
  },

  enumTiles(key, options, colsClass = "cols-3") {
    const grid = el("div", { class: "tile-grid " + colsClass });
    for (const opt of options) {
      if (opt.placeholder) {
        grid.appendChild(el("div", { class: "tile is-placeholder" }));
        continue;
      }
      const t = el("button", {
        type: "button",
        class: "tile" + (this.state[key] === opt.value ? " is-selected" : ""),
        onclick: () => {
          this.state[key] = opt.value;
          this.renderTicket();
          this.renderEditor();
          this.refreshFooter();
        },
      }, opt.label);
      grid.appendChild(t);
    }
    return grid;
  },

  toggleTile(key, label) {
    const t = el("button", {
      type: "button",
      class: "tile" + (this.state[key] ? " is-selected" : ""),
      onclick: () => {
        this.state[key] = !this.state[key];
        this.renderTicket();
        this.renderEditor();
        this.refreshFooter();
      },
    }, label);
    return t;
  },

  section(title) {
    const sec = el("div", { class: "editor-section" });
    if (title) sec.appendChild(el("div", { class: "editor-section-title" }, title));
    this.editorEl.appendChild(sec);
    return sec;
  },

  editCustomer() {
    this.editorHead("Customer", "Phone, address, dates");
    const sec = this.section();
    sec.appendChild(this.textField("Name", "customer_name", { placeholder: "Customer name" }));
    sec.appendChild(this.textField("Phone", "customer_phone", { type: "tel", inputmode: "tel", placeholder: "(914) 555-0123" }));
    const addrGrid = el("div", { class: "editor-grid-2" });
    addrGrid.appendChild(this.textField("Address", "customer_address", { placeholder: "Street, city" }));
    addrGrid.appendChild(this.textField("Zip code", "customer_zip", { inputmode: "numeric", placeholder: "10601" }));
    sec.appendChild(addrGrid);
    sec.appendChild(this.textField("Email (optional)", "customer_email", { type: "email" }));

    const dates = this.section("Dates");
    const dgrid = el("div", { class: "editor-grid-2" });
    const recvWrap = el("div", { class: "editor-field" });
    recvWrap.appendChild(el("div", { class: "editor-field-label" }, "Date received"));
    const recv = el("input", { class: "editor-input", type: "date", value: this.state.date_received });
    recv.addEventListener("input", (e) => { this.state.date_received = e.target.value; this.renderTicket(); });
    recvWrap.appendChild(recv);
    const promWrap = el("div", { class: "editor-field" });
    promWrap.appendChild(el("div", { class: "editor-field-label" }, "Date promised"));
    const prom = el("input", { class: "editor-input", type: "date", value: this.state.date_promised });
    prom.addEventListener("input", (e) => { this.state.date_promised = e.target.value; this.renderTicket(); });
    promWrap.appendChild(prom);
    dgrid.appendChild(recvWrap);
    dgrid.appendChild(promWrap);
    dates.appendChild(dgrid);
  },

  editDescription() {
    this.editorHead("Item description", "What is being framed");
    const sec = this.section();
    sec.appendChild(this.textField("Description", "description_of_item", {
      textarea: true, placeholder: "e.g. Pencil sketch, 1970s photo print",
    }));
    sec.appendChild(this.numField("Declared value $", "declared_value", { placeholder: "0.00" }));

    const photoSec = this.section("Artwork photo");
    const row = el("div", { class: "editor-photo" });
    const thumb = el("div", { class: "editor-photo-thumb" });
    if (this.state.artwork_photo_url) thumb.style.backgroundImage = `url('${this.state.artwork_photo_url}')`;
    else thumb.textContent = "\u{1F5BC}";
    row.appendChild(thumb);
    const photoBtn = el("button", { class: "btn btn-secondary", type: "button" },
      this.state.artwork_photo_url ? "Replace photo" : "Take photo");
    photoBtn.addEventListener("click", () => this.openPhotoPicker());
    row.appendChild(photoBtn);
    if (this.state.artwork_photo_url) {
      const clearBtn = el("button", { class: "btn btn-danger", type: "button" }, "Remove");
      clearBtn.addEventListener("click", () => {
        this.state.artwork_photo_url = "";
        this.renderTicket();
        this.renderEditor();
      });
      row.appendChild(clearBtn);
    }
    photoSec.appendChild(row);
  },

  editFrame() {
    this.editorHead("Frame", "Outer frame size, molding, price");
    const sec = this.section();
    const sizeWrap = el("div", { class: "editor-field" });
    sizeWrap.appendChild(el("div", { class: "editor-field-label" }, "Size (W x H)"));
    const sizeIn = el("input", {
      class: "editor-input", type: "text",
      placeholder: "16 x 20",
      value: this.state.frame_size || "",
    });
    sizeIn.addEventListener("input", (e) => {
      this.state.frame_size = e.target.value;
      this.renderTicket(); this.refreshFooter();
    });
    sizeIn.addEventListener("blur", () => {
      const feet = feetFromSize(this.state.frame_size);
      if (feet != null) {
        this.state.frame_feet = String(feet);
        this.recomputeAmounts();
        this.renderTicket();
        this.renderEditor();
        this.refreshFooter();
      }
    });
    sizeWrap.appendChild(sizeIn);
    sec.appendChild(sizeWrap);

    // Build molding/feet/price inputs explicitly so clearing the molding
    // number can also clear the price input's DOM value without a re-render
    // (which would steal focus from the molding input).
    const grid = el("div", { class: "editor-grid-3" });
    const moldingWrap = this.textField("Molding no", "frame_molding_no", { placeholder: "e.g. LJ-372181" });
    grid.appendChild(moldingWrap);
    const feetWrap = this.numField("Feet (auto from size)", "frame_feet", {
      placeholder: "0.00",
      onInput: () => { this.recomputeAmounts(); this.renderTicket(); this.refreshFooter(); },
    });
    grid.appendChild(feetWrap);
    const priceWrap = this.numField("$ / ft", "frame_price_per_foot", {
      placeholder: "0.00",
      onInput: () => { this.recomputeAmounts(); this.renderTicket(); this.refreshFooter(); },
    });
    grid.appendChild(priceWrap);
    // When molding_no is cleared, also clear the auto-filled $/ft.
    const moldingIn = moldingWrap.querySelector("input");
    const priceIn = priceWrap.querySelector("input");
    moldingIn.addEventListener("input", () => {
      if (this.state.frame_molding_no === "") {
        this.state.frame_price_per_foot = "";
        priceIn.value = "";
        this.recomputeAmounts();
        this.renderTicket();
        this.refreshFooter();
      }
    });
    sec.appendChild(grid);
    sec.appendChild(this.amountField("frame_amount"));

    const presetSec = this.section("Common moldings");
    const presetGrid = el("div", { class: "tile-grid cols-3" });
    for (const p of FRAME_MOLDING_PRESETS) {
      const selected = this.state.frame_molding_no === p.molding_no;
      const tile = el("button", {
        type: "button",
        class: "tile" + (selected ? " is-selected" : ""),
        onclick: () => {
          this.state.frame_molding_no = p.molding_no;
          this.state.frame_price_per_foot = p.price;
          this.recomputeAmounts();
          this.renderTicket();
          this.renderEditor();
          this.refreshFooter();
        },
      }, p.label);
      presetGrid.appendChild(tile);
    }
    presetSec.appendChild(presetGrid);
  },

  editLiner() {
    this.editorHead("Liner", "Optional inner liner around the artwork");
    const sec = this.section();
    sec.appendChild(this.textField("Size", "liner_size", { placeholder: "16 x 20" }));
    const grid = el("div", { class: "editor-grid-3" });
    const linerWrap = this.textField("Liner no", "liner_no");
    grid.appendChild(linerWrap);
    const lFeetWrap = this.numField("Feet", "liner_feet", {
      onInput: () => { this.recomputeAmounts(); this.renderTicket(); this.refreshFooter(); },
    });
    grid.appendChild(lFeetWrap);
    const lPriceWrap = this.numField("$ / ft", "liner_price_per_foot", {
      onInput: () => { this.recomputeAmounts(); this.renderTicket(); this.refreshFooter(); },
    });
    grid.appendChild(lPriceWrap);
    const lNoIn = linerWrap.querySelector("input");
    const lPriceIn = lPriceWrap.querySelector("input");
    lNoIn.addEventListener("input", () => {
      if (this.state.liner_no === "") {
        this.state.liner_price_per_foot = "";
        lPriceIn.value = "";
        this.recomputeAmounts();
        this.renderTicket();
        this.refreshFooter();
      }
    });
    sec.appendChild(grid);
    sec.appendChild(this.amountField("liner_amount"));

    const presetSec = this.section("Common liners");
    const presetGrid = el("div", { class: "tile-grid cols-3" });
    for (const p of LINER_PRESETS) {
      const selected = this.state.liner_no === p.liner_no;
      const tile = el("button", {
        type: "button",
        class: "tile" + (selected ? " is-selected" : ""),
        onclick: () => {
          this.state.liner_no = p.liner_no;
          this.state.liner_price_per_foot = p.price;
          this.recomputeAmounts();
          this.renderTicket();
          this.renderEditor();
          this.refreshFooter();
        },
      }, p.label);
      presetGrid.appendChild(tile);
    }
    presetSec.appendChild(presetGrid);
  },

  editMat() {
    const which = this.state.mat_tab || "mat1";
    const title = which === "mat1" ? "Mat #1" : "Mat #2";
    this.editorHead(title, "Type, color, margins T S B");

    // Tab toggle
    const tabs = el("div", { class: "mat-tabs" });
    for (const t of ["mat1", "mat2"]) {
      const btn = el("button", {
        type: "button",
        class: "mat-tab" + (which === t ? " is-active" : ""),
        onclick: () => { this.state.mat_tab = t; this.renderTicket(); this.renderEditor(); },
      }, t === "mat1" ? "Mat #1" : "Mat #2");
      tabs.appendChild(btn);
    }
    this.editorEl.appendChild(tabs);

    const sec = this.section();
    sec.appendChild(this.textField("Type", `${which}_type`, { placeholder: "single ivory mat" }));
    sec.appendChild(this.textField("Color", `${which}_color`, { placeholder: "Ivory" }));

    const colorSec = this.section("Common colors");
    const colorGrid = el("div", { class: "tile-grid cols-4" });
    for (const c of MAT_COLOR_PRESETS) {
      const selected = this.state[`${which}_color`] === c;
      colorGrid.appendChild(el("button", {
        type: "button",
        class: "tile tile-secondary" + (selected ? " is-selected" : ""),
        onclick: () => { this.state[`${which}_color`] = c; this.renderTicket(); this.renderEditor(); },
      }, c));
    }
    colorSec.appendChild(colorGrid);

    const margSec = this.section("Margins (inches)");
    const margGrid = el("div", { class: "editor-grid-3" });
    margGrid.appendChild(this.numField("Top (T)", `${which}_margin_top_in`, { placeholder: "0.0" }));
    margGrid.appendChild(this.numField("Sides (S)", `${which}_margin_sides_in`, { placeholder: "0.0" }));
    margGrid.appendChild(this.numField("Bottom (B)", `${which}_margin_bottom_in`, { placeholder: "0.0" }));
    margSec.appendChild(margGrid);

    const amtSec = this.section("Amount");
    amtSec.appendChild(this.amountField(`${which}_amount`));
  },

  editGlass() {
    this.editorHead("Glass", "Glazing material");
    const sec = this.section();
    // 3-column grid mirroring the paper: Regular/Non-glare | Plexi/Acrylic | Mirror
    const grid = el("div", { class: "tile-grid cols-3" });
    const opts = [
      { value: "regular",  label: "Regular" },
      { value: "plexi",    label: "Plexi" },
      { value: "mirror",   label: "Mirror" },
      { value: "non_glare", label: "Non-glare" },
      { value: "acrylic",  label: "Acrylic" },
      { placeholder: true },
    ];
    for (const opt of opts) {
      if (opt.placeholder) {
        grid.appendChild(el("div", { class: "tile is-placeholder" }));
        continue;
      }
      grid.appendChild(el("button", {
        type: "button",
        class: "tile" + (this.state.glass_kind === opt.value ? " is-selected" : ""),
        onclick: () => { this.state.glass_kind = opt.value; this.renderTicket(); this.renderEditor(); },
      }, opt.label));
    }
    sec.appendChild(grid);

    const amtSec = this.section("Amount");
    amtSec.appendChild(this.amountField("glass_amount"));
  },

  editMount() {
    this.editorHead("Mount", "How the artwork is held");
    const sec = this.section();
    // 2-column grid mirroring the paper: Dry/Wet | Museum
    const grid = el("div", { class: "tile-grid cols-2" });
    const opts = [
      { value: "dry",    label: "Dry" },
      { value: "museum", label: "Museum" },
      { value: "wet",    label: "Wet" },
      { placeholder: true },
    ];
    for (const opt of opts) {
      if (opt.placeholder) {
        grid.appendChild(el("div", { class: "tile is-placeholder" }));
        continue;
      }
      grid.appendChild(el("button", {
        type: "button",
        class: "tile" + (this.state.mount_kind === opt.value ? " is-selected" : ""),
        onclick: () => { this.state.mount_kind = opt.value; this.renderTicket(); this.renderEditor(); },
      }, opt.label));
    }
    sec.appendChild(grid);

    sec.appendChild(this.textField("Type of backer", "mount_backer_type", { placeholder: "Foamcore, acid-free" }));
    const amtSec = this.section("Amount");
    amtSec.appendChild(this.amountField("mount_amount"));
  },

  editHanger() {
    this.editorHead("Hanger", "How the customer hangs it");
    const sec = this.section();
    const grid = el("div", { class: "tile-grid cols-3" });
    for (const [val, label] of Object.entries(HANGER_LABELS)) {
      grid.appendChild(el("button", {
        type: "button",
        class: "tile" + (this.state.hanger_kind === val ? " is-selected" : ""),
        onclick: () => { this.state.hanger_kind = val; this.renderTicket(); this.renderEditor(); },
      }, label));
    }
    sec.appendChild(grid);
    const amtSec = this.section("Amount");
    amtSec.appendChild(this.amountField("hanger_amount"));
  },

  editServices() {
    this.editorHead("Misc. services", "Extra work performed");
    const sec = this.section();
    // 2x2 grid mirroring the paper: Stretch/Repair | Block/Fitting
    const grid = el("div", { class: "tile-grid cols-2" });
    grid.appendChild(this.toggleTile("service_stretch", "Stretch"));
    grid.appendChild(this.toggleTile("service_repair",  "Repair"));
    grid.appendChild(this.toggleTile("service_block",   "Block"));
    grid.appendChild(this.toggleTile("service_fitting", "Fitting"));
    sec.appendChild(grid);
    const amtSec = this.section("Amount");
    amtSec.appendChild(this.amountField("services_amount"));
  },

  editSupplies() {
    this.editorHead("Misc. supplies", "Anything else billed");
    const sec = this.section();
    sec.appendChild(this.textField("Supplies", "misc_supplies", { placeholder: "e.g. spacers, dust cover" }));
    sec.appendChild(this.amountField("misc_supplies_amount"));
  },

  editNotes() {
    this.editorHead("Special instructions", "Notes for the back-of-house framer");
    const sec = this.section();
    sec.appendChild(this.textField("Notes", "special_instructions", {
      textarea: true,
      placeholder: "e.g. heat-sensitive, customer wants warm tone preserved, two-person carry",
    }));
  },

  editSignaturePlaceholder() {
    this.editorHead("Customer signature", "Tap the signature row to capture");
    const sec = this.section();
    sec.appendChild(el("div", { class: "page-sub" }, "Open the signature pad from the bottom of the ticket pane."));
    const btn = el("button", { class: "btn btn-primary btn-large", type: "button" }, "Open signature pad");
    btn.addEventListener("click", () => this.openSignaturePad());
    sec.appendChild(btn);
  },

  // --------- Photo picker ---------
  openPhotoPicker() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        this.state.artwork_photo_url = ev.target.result;
        this.renderTicket();
        this.renderEditor();
      };
      reader.readAsDataURL(file);
    });
    input.click();
  },

  // --------- Tax rate ---------
  openTaxRateModal() {
    this.showModal((close) => {
      const m = el("div", { class: "modal" });
      m.appendChild(el("h3", { class: "modal-title" }, "Tax rate"));
      const inp = el("input", {
        class: "modal-input", type: "text", inputmode: "decimal",
        value: (num(this.state.tax_rate) * 100).toFixed(3).replace(/\.?0+$/, ""),
      });
      m.appendChild(inp);
      const shopRate = num(SHOP?.tax_rate, 0);
      const shopRatePct = (shopRate * 100).toFixed(3).replace(/\.?0+$/, "");
      m.appendChild(el("div", { class: "editor-sub" }, `Shop default: ${shopRatePct}%`));
      const actions = el("div", { class: "modal-actions" });
      actions.appendChild(el("button", { class: "btn btn-secondary", type: "button", onclick: close }, "Cancel"));
      actions.appendChild(el("button", { class: "btn btn-primary", type: "button", onclick: () => {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v) && v >= 0) {
          this.state.tax_rate = v / 100;
          this.renderTicket();
          this.refreshFooter();
        }
        close();
      }}, "Save"));
      m.appendChild(actions);
      setTimeout(() => inp.focus(), 30);
      return m;
    });
  },

  // --------- Signature pad ---------
  openSignaturePad() {
    this.state.active_editor = "signature";
    this.renderTicket();
    this.renderEditor();

    const overlay = el("div", { class: "signature-overlay" });
    overlay.appendChild((() => {
      const h = el("div", { class: "signature-overlay-head" });
      h.appendChild(el("h2", { class: "signature-overlay-title" }, "Customer signature"));
      h.appendChild(el("div", { class: "signature-overlay-ticket" }, `Ticket #${this.state.next_ticket_no || "—"}`));
      return h;
    })());
    overlay.appendChild(el("div", { class: "signature-overlay-auth" }, AUTH_TEXT));

    const canvasWrap = el("div", { class: "signature-canvas-wrap" });
    const canvas = el("canvas", { class: "signature-canvas" });
    canvasWrap.appendChild(canvas);
    canvasWrap.appendChild(el("div", { class: "signature-canvas-baseline" }, "Sign above this line"));
    overlay.appendChild(canvasWrap);

    const actions = el("div", { class: "signature-overlay-actions" });
    const left = el("div", { class: "left" });
    const right = el("div", { class: "right" });
    const clearBtn = el("button", { class: "btn btn-secondary", type: "button" }, "Clear");
    const cancelBtn = el("button", { class: "btn btn-secondary", type: "button" }, "Cancel");
    const doneBtn = el("button", { class: "btn btn-primary btn-large", type: "button" }, "Done");
    left.appendChild(clearBtn);
    right.appendChild(cancelBtn);
    right.appendChild(doneBtn);
    actions.appendChild(left);
    actions.appendChild(right);
    overlay.appendChild(actions);

    document.body.appendChild(overlay);

    // Canvas sizing — use devicePixelRatio for crisp lines.
    const dpr = window.devicePixelRatio || 1;
    const sizeCanvas = () => {
      const rect = canvasWrap.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1a3a7a";
      ctx.lineWidth = 2.2;
      // Render existing signature if present.
      if (this.state.customer_signature_png) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
        img.src = this.state.customer_signature_png;
      }
    };
    setTimeout(sizeCanvas, 0);

    const ctx = canvas.getContext("2d");
    let drawing = false;
    let last = null;
    let hasDrawn = !!this.state.customer_signature_png;

    function pos(ev) {
      const rect = canvas.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    }
    canvas.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      drawing = true;
      hasDrawn = true;
      last = pos(ev);
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener("pointermove", (ev) => {
      if (!drawing) return;
      const p = pos(ev);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    });
    canvas.addEventListener("pointerup", () => { drawing = false; last = null; });
    canvas.addEventListener("pointercancel", () => { drawing = false; last = null; });

    clearBtn.addEventListener("click", () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawn = false;
    });
    cancelBtn.addEventListener("click", () => overlay.remove());
    doneBtn.addEventListener("click", () => {
      if (!hasDrawn) {
        toast("Please sign first", "error");
        return;
      }
      const png = canvas.toDataURL("image/png");
      this.state.customer_signature_png = png;
      this.state.customer_signed_at = new Date().toISOString();
      overlay.remove();
      this.renderTicket();
      this.renderEditor();
    });

    window.addEventListener("resize", sizeCanvas);
  },

  // --------- Scan ticket ---------
  startScan() {
    if (this.scanInputEl) {
      this.scanInputEl.value = "";
      this.scanInputEl.click();
    }
  },

  async onScanFile(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      await this.doScan(dataUrl);
    };
    reader.readAsDataURL(file);
  },

  async doScan(dataUrl) {
    const spinner = el("div", { class: "scan-spinner" });
    spinner.appendChild(el("div", { class: "ring" }));
    spinner.appendChild(el("div", { class: "scan-spinner-text" }, "Reading ticket…"));
    document.body.appendChild(spinner);
    try {
      const res = await fetch("/api/order/scan_ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_data_url: dataUrl }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || !json.ok) {
        const msg = json?.error || `Scan failed (${res.status})`;
        toast(msg, "error");
        if (json?.raw) console.warn("Scan raw response:", json.raw);
        return;
      }
      this.applyScanFields(json.fields || {});
      toast("Ticket prefilled. Review before saving.");
    } catch (err) {
      console.error(err);
      toast("Scan failed: " + err.message, "error");
    } finally {
      spinner.remove();
    }
  },

  applyScanFields(f) {
    const s = this.state;
    const setStr = (k) => { if (f[k] != null) s[k] = String(f[k]); };
    const setNum = (k) => { if (f[k] != null && f[k] !== "") s[k] = String(f[k]); };
    const setEnum = (k, allowed, fallback) => {
      if (f[k] && allowed.includes(f[k])) s[k] = f[k];
      else if (f[k] && !allowed.includes(f[k])) s[k] = fallback;
    };
    const setBool = (k) => { if (typeof f[k] === "boolean") s[k] = f[k]; };

    ["customer_name", "customer_phone", "customer_address", "customer_zip",
     "date_received", "date_promised", "description_of_item",
     "frame_size", "frame_molding_no",
     "liner_size", "liner_no",
     "mat1_type", "mat1_color", "mat2_type", "mat2_color",
     "mount_backer_type",
     "misc_supplies", "special_instructions",
    ].forEach(setStr);

    ["declared_value", "frame_feet", "frame_price_per_foot", "frame_amount",
     "liner_feet", "liner_price_per_foot", "liner_amount",
     "mat1_margin_top_in", "mat1_margin_sides_in", "mat1_margin_bottom_in", "mat1_amount",
     "mat2_margin_top_in", "mat2_margin_sides_in", "mat2_margin_bottom_in", "mat2_amount",
     "glass_amount", "mount_amount", "hanger_amount",
     "services_amount", "misc_supplies_amount",
     "deposit_amount",
    ].forEach(setNum);

    setEnum("glass_kind", ["regular", "non_glare", "plexi", "acrylic", "mirror"], "regular");
    setEnum("mount_kind", ["dry", "wet", "museum"], "dry");
    setEnum("hanger_kind", ["wire", "easel", "sawtooth"], "wire");

    ["service_stretch", "service_repair", "service_block", "service_fitting"].forEach(setBool);

    this.render();
  },

  // --------- Modal helper ---------
  showModal(builder) {
    const root = $("modal-root");
    const backdrop = el("div", { class: "modal-backdrop" });
    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", function onEsc(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); }
    });
    backdrop.appendChild(builder(close));
    root.appendChild(backdrop);
  },

  // --------- Submit ---------
  async submit() {
    if (!this.canSave()) return;
    const s = this.state;
    const t = this.totals();
    const body = {
      customer_name: s.customer_name.trim(),
      customer_phone: s.customer_phone.trim(),
      date_received: s.date_received,
      date_promised: s.date_promised,
      description_of_item: s.description_of_item.trim(),
      frame_size: s.frame_size.trim(),
      glass_kind: s.glass_kind,
      mount_kind: s.mount_kind,
      hanger_kind: s.hanger_kind,
      service_stretch: !!s.service_stretch,
      service_repair: !!s.service_repair,
      service_block: !!s.service_block,
      service_fitting: !!s.service_fitting,
      subtotal: t.subtotal.toFixed(2),
      tax_amount: t.tax.toFixed(2),
      total: t.total.toFixed(2),
      deposit_amount: t.deposit.toFixed(2),
      balance_due: t.balance.toFixed(2),
    };

    // Optional strings
    const optStr = [
      "customer_address", "customer_zip", "customer_email",
      "frame_molding_no",
      "liner_size", "liner_no",
      "mat1_type", "mat1_color", "mat2_type", "mat2_color",
      "mount_backer_type",
      "misc_supplies", "special_instructions",
      "customer_signature_png", "customer_signed_at",
      "artwork_photo_url",
    ];
    for (const k of optStr) {
      const v = (s[k] || "").toString().trim();
      if (v) body[k] = v;
    }

    // Optional decimals (send as strings; Grove accepts decimal-as-string)
    const optDec = [
      "declared_value",
      "frame_feet", "frame_price_per_foot", "frame_amount",
      "liner_feet", "liner_price_per_foot", "liner_amount",
      "mat1_margin_top_in", "mat1_margin_sides_in", "mat1_margin_bottom_in", "mat1_amount",
      "mat2_margin_top_in", "mat2_margin_sides_in", "mat2_margin_bottom_in", "mat2_amount",
      "glass_amount", "mount_amount", "hanger_amount",
      "services_amount", "misc_supplies_amount",
    ];
    for (const k of optDec) {
      const v = s[k];
      if (v !== "" && v != null && Number.isFinite(Number(v))) body[k] = String(v);
    }

    this.saveBtnEl.disabled = true;
    this.saveBtnEl.textContent = "Saving…";

    try {
      const res = await fetch("/api/order/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`${res.status}: ${txt.slice(0, 300)}`);
      }
      const json = await res.json();
      toast("Ticket saved");
      setTimeout(() => { window.location.href = `/counter/order.html?id=${json.record.id}`; }, 400);
    } catch (err) {
      console.error(err);
      toast("Save failed: " + err.message, "error");
      this.saveBtnEl.disabled = false;
      this.saveBtnEl.textContent = "Save ticket";
    }
  },
};

// ===================================================================
// CounterOrder — read-only ticket view + stage actions
// ===================================================================
const CounterOrder = {
  order: null,
  _indicator: null,

  async mount() {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) { $("order-main").textContent = "No order id given."; return; }
    this._indicator = mountSyncIndicator($("sync-indicator"));
    livePoll(
      () => this.fetchOrder(id),
      (o) => this.applyUpdate(o),
      { onSync: this._indicator.onSync },
    );
  },

  async fetchOrder(id) {
    const res = await fetch(`/api/order/${encodeURIComponent(id)}`);
    if (!res.ok) {
      // 404 — render the empty state once; livePoll will keep retrying
      // silently in case the order shows up later (e.g. fresh insert
      // hasn't projected yet).
      $("order-main").innerHTML = `<p class="empty">Order not found.</p>`;
      throw new Error("not found");
    }
    return res.json();
  },

  applyUpdate(o) {
    this.order = o;
    this.render();
  },

  // Kept for the post-action refresh path. Same behavior as before:
  // immediate fetch + render after the user advances/reverts a stage.
  async load(id) {
    try {
      const o = await this.fetchOrder(id);
      this.applyUpdate(o);
    } catch { /* fetchOrder already painted the empty state */ }
  },

  render() {
    const o = this.order;
    const main = $("order-main");
    main.innerHTML = "";

    const head = el("div", { class: "detail-head" });
    const headLeft = el("div", {});
    headLeft.appendChild(el("div", { class: "detail-ticket-no" }, `Ticket #${o.ticket_no || "—"}`));
    headLeft.appendChild(el("h1", { class: "detail-customer" }, o.customer_name));
    headLeft.appendChild(el("div", { class: "detail-phone" },
      `${o.customer_phone || ""}${o.date_promised ? " · Promised " + fmtDate(o.date_promised) : ""}`));
    head.appendChild(headLeft);
    head.appendChild(el("span", { class: `stage stage-${o.stage}` }, STAGE_LABELS[o.stage] || o.stage));
    main.appendChild(head);

    const grid = el("div", { class: "detail-grid" });
    const left = el("div", {});

    if (o.artwork_photo_url) {
      left.appendChild(el("img", { class: "spec-photo", src: o.artwork_photo_url, alt: "Artwork" }));
    }

    // Customer section
    const cust = this.section("Customer");
    this.specRow(cust, "Name", o.customer_name);
    this.specRow(cust, "Phone", o.customer_phone);
    if (o.customer_address) this.specRow(cust, "Address", o.customer_address);
    if (o.customer_zip)     this.specRow(cust, "Zip", o.customer_zip);
    if (o.customer_email)   this.specRow(cust, "Email", o.customer_email);
    this.specRow(cust, "Date received", fmtDate(o.date_received));
    this.specRow(cust, "Date promised", fmtDate(o.date_promised));
    left.appendChild(cust);

    // Job description
    const desc = this.section("Item");
    if (o.description_of_item) this.specRowBlock(desc, "Description", o.description_of_item);
    if (o.declared_value != null && o.declared_value !== "") this.specRow(desc, "Declared value", fmtMoney(o.declared_value));
    left.appendChild(desc);

    // Frame
    const frame = this.section("Frame");
    this.specRow(frame, "Size", o.frame_size);
    if (o.frame_molding_no) this.specRow(frame, "Molding no", o.frame_molding_no);
    if (o.frame_feet)        this.specRow(frame, "Feet", `${trimDecimal(o.frame_feet)} ft`);
    if (o.frame_price_per_foot) this.specRow(frame, "$ / ft", fmtMoney(o.frame_price_per_foot));
    if (num(o.frame_amount) > 0) this.specRow(frame, "Amount", fmtMoney(o.frame_amount));
    left.appendChild(frame);

    if (o.liner_size || o.liner_no || num(o.liner_amount) > 0) {
      const liner = this.section("Liner");
      if (o.liner_size) this.specRow(liner, "Size", o.liner_size);
      if (o.liner_no) this.specRow(liner, "Liner no", o.liner_no);
      if (o.liner_feet) this.specRow(liner, "Feet", `${trimDecimal(o.liner_feet)} ft`);
      if (o.liner_price_per_foot) this.specRow(liner, "$ / ft", fmtMoney(o.liner_price_per_foot));
      if (num(o.liner_amount) > 0) this.specRow(liner, "Amount", fmtMoney(o.liner_amount));
      left.appendChild(liner);
    }

    for (const n of [1, 2]) {
      const t = o[`mat${n}_type`], c = o[`mat${n}_color`];
      const top = o[`mat${n}_margin_top_in`], sd = o[`mat${n}_margin_sides_in`], bot = o[`mat${n}_margin_bottom_in`];
      if (!t && !c && !top && !sd && !bot && !num(o[`mat${n}_amount`])) continue;
      const mat = this.section(`Mat #${n}`);
      if (t) this.specRow(mat, "Type", t);
      if (c) this.specRow(mat, "Color", c);
      const margins = [];
      if (top) margins.push(`T ${trimDecimal(top)}"`);
      if (sd)  margins.push(`S ${trimDecimal(sd)}"`);
      if (bot) margins.push(`B ${trimDecimal(bot)}"`);
      if (margins.length) this.specRow(mat, "Margins", margins.join(" · "));
      if (num(o[`mat${n}_amount`]) > 0) this.specRow(mat, "Amount", fmtMoney(o[`mat${n}_amount`]));
      left.appendChild(mat);
    }

    // Glass / mount / hanger
    const matSec = this.section("Glass / mount / hanger");
    this.specRow(matSec, "Glass", GLASS_LABELS[o.glass_kind] || o.glass_kind);
    if (num(o.glass_amount) > 0) this.specRow(matSec, "Glass amount", fmtMoney(o.glass_amount));
    this.specRow(matSec, "Mount", MOUNT_LABELS[o.mount_kind] || o.mount_kind);
    if (o.mount_backer_type) this.specRow(matSec, "Backer", o.mount_backer_type);
    if (num(o.mount_amount) > 0) this.specRow(matSec, "Mount amount", fmtMoney(o.mount_amount));
    this.specRow(matSec, "Hanger", HANGER_LABELS[o.hanger_kind] || o.hanger_kind);
    if (num(o.hanger_amount) > 0) this.specRow(matSec, "Hanger amount", fmtMoney(o.hanger_amount));
    left.appendChild(matSec);

    // Services / supplies
    const svc = [];
    for (const [k, label] of Object.entries(SERVICE_LABELS)) {
      if (o[k]) svc.push(label);
    }
    if (svc.length || o.misc_supplies || num(o.services_amount) > 0 || num(o.misc_supplies_amount) > 0) {
      const sec = this.section("Misc");
      if (svc.length) this.specRow(sec, "Services", svc.join(", "));
      if (num(o.services_amount) > 0) this.specRow(sec, "Services amount", fmtMoney(o.services_amount));
      if (o.misc_supplies) this.specRow(sec, "Supplies", o.misc_supplies);
      if (num(o.misc_supplies_amount) > 0) this.specRow(sec, "Supplies amount", fmtMoney(o.misc_supplies_amount));
      left.appendChild(sec);
    }

    // Totals
    const totals = this.section("Totals");
    this.specRow(totals, "Subtotal", fmtMoney(o.subtotal));
    this.specRow(totals, "Tax", fmtMoney(o.tax_amount));
    this.specRow(totals, "Total", fmtMoney(o.total));
    this.specRow(totals, "Deposit", fmtMoney(o.deposit_amount));
    this.specRow(totals, "Balance due", fmtMoney(o.balance_due));
    left.appendChild(totals);

    // Signature
    if (o.customer_signature_png) {
      const sigSec = this.section("Customer signature");
      const wrap = el("div", { class: "spec-signature" },
        el("img", { src: o.customer_signature_png, alt: "Signature" }));
      sigSec.appendChild(wrap);
      if (o.customer_signed_at) {
        sigSec.appendChild(el("div", { class: "spec-signature-time" }, "Signed " + fmtDateTime(o.customer_signed_at)));
      }
      left.appendChild(sigSec);
    }

    // Right pane
    const right = el("div", {});
    if (o.special_instructions) {
      const notes = el("div", { class: "notes-block" });
      notes.innerHTML = `<span class="lbl">Special instructions</span>${escapeHtml(o.special_instructions)}`;
      right.appendChild(notes);
    }
    right.appendChild(this.stageActions(o));

    grid.append(left, right);
    main.appendChild(grid);
  },

  section(title) {
    const sec = el("div", { class: "spec-section" });
    sec.appendChild(el("div", { class: "spec-section-title" }, title));
    return sec;
  },

  specRow(into, label, value) {
    if (value == null || value === "") return;
    const row = el("div", { class: "spec-row" });
    row.appendChild(el("span", { class: "spec-label" }, label));
    row.appendChild(el("span", { class: "spec-value" }, value));
    into.appendChild(row);
  },

  specRowBlock(into, label, value) {
    if (value == null || value === "") return;
    const row = el("div", { class: "spec-row" });
    row.appendChild(el("span", { class: "spec-label" }, label));
    row.appendChild(el("span", { class: "spec-value-block" }, value));
    into.appendChild(row);
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
    const revert = this.revertAction(o.stage);
    if (revert) {
      wrap.appendChild(el("button", {
        class: "btn btn-secondary btn-block",
        onclick: () => this.revert(o, revert),
      }, "← " + revert.label));
    }
    if (o.stage !== "picked_up" && o.stage !== "cancelled") {
      wrap.appendChild(el("button", {
        class: "btn btn-danger btn-block",
        onclick: () => this.cancel(o),
      }, "Cancel order"));
    }
    if (o.stage === "cancelled") {
      wrap.appendChild(el("div", { class: "page-sub" }, "This order is cancelled."));
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

  revertAction(stage) {
    switch (stage) {
      case "cutting_materials":  return { action: "revert_to_intake",    label: "Back to intake" };
      case "assembly":           return { action: "revert_to_cutting",   label: "Back to cutting materials" };
      case "ready_for_pickup":   return { action: "revert_to_assembly",  label: "Back to assembly" };
      case "picked_up":          return { action: "revert_pickup",       label: "Undo pickup" };
      default:                   return null;
    }
  },

  async advance(o, { action, label, needsBalance }) {
    if (needsBalance && num(o.balance_due) > 0) {
      const ans = prompt(
        `Balance still due is ${fmtMoney(o.balance_due)}.\n` +
        `Enter amount the customer paid now to zero it out:`,
        String(o.balance_due));
      if (ans == null) return;
      const paid = parseFloat(ans);
      if (!Number.isFinite(paid) || paid < 0) {
        toast("Enter a valid amount", "error"); return;
      }
      const newDeposit = round2(num(o.deposit_amount) + paid);
      const newBalance = round2(num(o.total) - newDeposit);
      // Send a full-state update so Grove doesn't null out other fields.
      const body = fullOrderBody(o);
      body.id = o.id;
      body.deposit_amount = newDeposit.toFixed(2);
      body.balance_due = newBalance.toFixed(2);
      try {
        const res = await fetch("/api/order/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      } catch (err) {
        toast("Failed to record payment: " + err.message, "error");
        return;
      }
    }
    await this.post(action, { id: o.id }, `${label.split(",")[0]} done`);
  },

  async revert(o, { action, label }) {
    if (!confirm(`${label}? This moves the order back a stage.`)) return;
    await this.post(action, { id: o.id }, label);
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

window.CounterDashboard = CounterDashboard;
window.CounterIntake = CounterIntake;
window.CounterOrder = CounterOrder;
