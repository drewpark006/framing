#!/usr/bin/env node
// seed.js — Populate the framing app with plausible Phil-style orders.
//
// Usage:
//   ./start.sh --db &      # start grove-server with persistence
//   node seed.js           # seed
//
// Re-running creates duplicates. Delete framing.sqlite to start clean.
//
// Note: this script POSTs directly to grove-server (not through serve.py),
// so ticket_no must be supplied explicitly. Real intakes via the iPad UI
// get ticket_no auto-assigned by serve.py.

import { callAction } from "./agents/lib/grove.js";

const API = process.env.GROVE_SERVER || "http://127.0.0.1:3000";

function isoDate(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

const ORDERS = [
  {
    ticket_no: "0045670",
    customer_name: "Margaret Liu",
    customer_phone: "914-555-0101",
    customer_address: "12 Elm St, White Plains, NY",
    customer_zip: "10605",
    customer_email: "mliu@example.com",
    date_received: isoDate(-2),
    date_promised: isoDate(10),
    description_of_item: "Pencil sketch from grandfather, fragile edges",
    declared_value: "350",
    frame_size: "18 x 24",
    frame_molding_no: "LJ-372181",
    frame_feet: "7",
    frame_price_per_foot: "2.85",
    frame_amount: "19.95",
    mat1_type: "double mat",
    mat1_color: "Ivory",
    mat1_margin_top_in: "2",
    mat1_margin_sides_in: "2",
    mat1_margin_bottom_in: "2.5",
    mat1_amount: "28.00",
    mat2_type: "bottom mat",
    mat2_color: "Charcoal",
    mat2_amount: "12.00",
    glass_kind: "non_glare",
    glass_amount: "45.00",
    mount_kind: "museum",
    mount_backer_type: "Acid-free foamcore",
    mount_amount: "18.00",
    hanger_kind: "wire",
    hanger_amount: "4.00",
    special_instructions: "Pencil sketch from grandfather, fragile edges. No spray. Hinge mount only.",
    subtotal: "126.95",
    tax_amount: "10.63",
    total: "137.58",
    deposit_amount: "120.00",
    balance_due: "17.58",
    advance_to: "cutting_materials",
  },
  {
    ticket_no: "0045671",
    customer_name: "Dave Okonkwo",
    customer_phone: "914-555-0144",
    date_received: isoDate(-5),
    date_promised: isoDate(2),
    description_of_item: "Photo print, 1970s, color tones warm",
    frame_size: "20 x 16",
    frame_molding_no: "ST-1011",
    frame_feet: "6",
    frame_price_per_foot: "2.10",
    frame_amount: "12.60",
    mat1_type: "single mat",
    mat1_color: "Cream",
    mat1_margin_top_in: "1.5",
    mat1_margin_sides_in: "1.5",
    mat1_margin_bottom_in: "1.5",
    mat1_amount: "18.00",
    glass_kind: "non_glare",
    glass_amount: "32.00",
    mount_kind: "dry",
    mount_amount: "10.00",
    hanger_kind: "sawtooth",
    hanger_amount: "3.00",
    special_instructions: "Customer wants warm tone preserved.",
    subtotal: "75.60",
    tax_amount: "6.33",
    total: "81.93",
    deposit_amount: "40.00",
    balance_due: "41.93",
    advance_to: "assembly",
  },
  {
    ticket_no: "0045672",
    customer_name: "Priya Shankar",
    customer_phone: "914-555-0188",
    customer_email: "priya.s@example.com",
    date_received: isoDate(-7),
    date_promised: isoDate(-1),
    description_of_item: "College diploma, float-mounted",
    frame_size: "11 x 14",
    frame_molding_no: "MB-100",
    frame_feet: "4.16",
    frame_price_per_foot: "1.80",
    frame_amount: "7.49",
    glass_kind: "regular",
    glass_amount: "18.00",
    mount_kind: "dry",
    mount_amount: "8.00",
    hanger_kind: "wire",
    hanger_amount: "3.00",
    service_fitting: true,
    services_amount: "6.00",
    special_instructions: "Float so corners are visible.",
    subtotal: "42.49",
    tax_amount: "3.56",
    total: "46.05",
    deposit_amount: "25.00",
    balance_due: "21.05",
    advance_to: "ready_for_pickup",
  },
];

const TRANSITIONS = {
  intake: [],
  cutting_materials: ["start_cutting"],
  assembly: ["start_cutting", "start_assembly"],
  ready_for_pickup: ["start_cutting", "start_assembly", "mark_ready"],
};

async function seed() {
  console.log(`Seeding ${ORDERS.length} orders against ${API}...\n`);

  let ok = 0, fail = 0;

  for (const o of ORDERS) {
    const { advance_to, ...createBody } = o;
    for (const k of Object.keys(createBody)) {
      if (createBody[k] === "") delete createBody[k];
    }

    try {
      const res = await callAction("create", createBody, API);
      const id = res.record.id;
      const transitions = TRANSITIONS[advance_to] || [];
      for (const t of transitions) {
        await callAction(t, { id }, API);
      }
      console.log(`  ok  #${o.ticket_no}  ${o.customer_name.padEnd(20)} -> ${advance_to}`);
      ok++;
    } catch (e) {
      console.error(`  err #${o.ticket_no}  ${o.customer_name}: ${e.message}`);
      fail++;
    }
  }

  console.log(`\nDone. ${ok} ok, ${fail} failed.`);
}

seed().catch(e => { console.error(e); process.exit(1); });
