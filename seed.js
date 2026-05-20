#!/usr/bin/env node
// seed.js — Populate the framing app with plausible Phil-style orders.
//
// Usage:
//   ./start.sh --db &      # start grove-server with persistence
//   node seed.js           # seed
//
// Re-running creates duplicates. Delete framing.sqlite to start clean.

import { callAction } from "./agents/lib/grove.js";

const API = process.env.GROVE_SERVER || "http://127.0.0.1:3000";

// Today (in shop) is taken from system clock; pickup dates are nudged forward.
function isoDate(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

const ORDERS = [
  {
    customer_name: "Margaret Liu",
    customer_phone: "614-555-0101",
    customer_email: "mliu@example.com",
    frame_style: "Larson-Juhl Brittney, 1.5 inch",
    frame_color: "matte black",
    frame_width_in: "18",
    frame_height_in: "24",
    mat_spec: "double mat, ivory top, charcoal bottom, 2 inch reveal",
    glass_type: "museum",
    mounting_type: "hinge",
    artwork_width_in: "14",
    artwork_height_in: "20",
    notes: "Pencil sketch from grandfather, fragile edges. No spray. Hinge mount only.",
    estimated_pickup_date: isoDate(10),
    deposit_amount: "120",
    advance_to: "cutting_materials",
  },
  {
    customer_name: "Dave Okonkwo",
    customer_phone: "614-555-0144",
    frame_style: "Studio Moulding Vintage 2 inch",
    frame_color: "walnut stain",
    frame_width_in: "20",
    frame_height_in: "16",
    mat_spec: "single mat, antique white, 1.5 inch",
    glass_type: "anti_glare",
    mounting_type: "dry_mount",
    artwork_width_in: "16",
    artwork_height_in: "12",
    notes: "Photo print, 1970s. Customer wants warm tone preserved.",
    estimated_pickup_date: isoDate(7),
    deposit_amount: "85",
    advance_to: "assembly",
  },
  {
    customer_name: "Priya Shankar",
    customer_phone: "614-555-0188",
    customer_email: "priya.s@example.com",
    frame_style: "Roma Modern thin profile, 0.75 inch",
    frame_color: "polished silver",
    frame_width_in: "11",
    frame_height_in: "14",
    mat_spec: "no mat, float over white backer",
    glass_type: "uv",
    mounting_type: "float",
    artwork_width_in: "8",
    artwork_height_in: "10",
    notes: "Diploma. Float so corners are visible.",
    estimated_pickup_date: isoDate(2),
    deposit_amount: "60",
    advance_to: "ready_for_pickup",
  },
  {
    customer_name: "Walt Brennan",
    customer_phone: "614-555-0173",
    frame_style: "Custom oak, shop-built, 1.25 inch",
    frame_color: "natural oak",
    frame_width_in: "30",
    frame_height_in: "40",
    mat_spec: "triple mat, cream / forest / cream, 2.5 inch overall",
    glass_type: "conservation",
    mounting_type: "hinge",
    artwork_width_in: "24",
    artwork_height_in: "36",
    notes: "Large oil painting on board. Two-person carry. Customer asked we hold it on the rack with a SOLD tag.",
    estimated_pickup_date: isoDate(-1),
    deposit_amount: "260",
    advance_to: "ready_for_pickup",
  },
  {
    customer_name: "Hank Wallace",
    customer_phone: "614-555-0119",
    frame_style: "Plein-air gold, ornate, 3 inch",
    frame_color: "antique gold leaf",
    frame_width_in: "16",
    frame_height_in: "20",
    mat_spec: "linen liner, oyster",
    glass_type: "museum",
    mounting_type: "float",
    artwork_width_in: "11",
    artwork_height_in: "14",
    notes: "Watercolor. Customer paid in full at pickup.",
    estimated_pickup_date: isoDate(-7),
    deposit_amount: "150",
    advance_to: "picked_up",
    final_balance: "180",
  },
  {
    customer_name: "Eliza Park",
    customer_phone: "614-555-0102",
    frame_style: "Larson-Juhl Sebastian, 1 inch",
    frame_color: "satin white",
    frame_width_in: "12",
    frame_height_in: "12",
    mat_spec: "",
    glass_type: "regular",
    mounting_type: "float",
    artwork_width_in: "8",
    artwork_height_in: "8",
    notes: "",
    estimated_pickup_date: isoDate(5),
    deposit_amount: "0",
    advance_to: "intake",
  },
];

const TRANSITIONS = {
  intake: [],
  cutting_materials: ["start_cutting"],
  assembly: ["start_cutting", "start_assembly"],
  ready_for_pickup: ["start_cutting", "start_assembly", "mark_ready"],
  picked_up: ["start_cutting", "start_assembly", "mark_ready", "pick_up"],
};

async function seed() {
  console.log(`Seeding ${ORDERS.length} orders against ${API}...\n`);

  let ok = 0, fail = 0;

  for (const o of ORDERS) {
    const { advance_to, final_balance, ...createBody } = o;
    // Strip empty optional strings so the server uses field defaults.
    for (const k of Object.keys(createBody)) {
      if (createBody[k] === "") delete createBody[k];
    }

    try {
      const res = await callAction("create", createBody, API);
      const id = res.record.id;
      const transitions = TRANSITIONS[advance_to] || [];
      for (const t of transitions) {
        const body = { id };
        if (t === "pick_up") body.final_balance = final_balance || "0";
        await callAction(t, body, API);
      }
      console.log(`  ✓ ${o.customer_name.padEnd(20)} → ${advance_to}`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${o.customer_name}: ${e.message}`);
      fail++;
    }
  }

  console.log(`\nDone. ${ok} ok, ${fail} failed.`);
}

seed().catch(e => { console.error(e); process.exit(1); });
