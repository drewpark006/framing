---
name: feedback-grove-state-events
description: "Grove state-machine events must include the new state value in their payload, not just the event name"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 40b83cf1-783c-4743-b3d3-f9ffd622a933
---

Grove state-machine transitions are validated at the projection layer using BOTH the event name AND the new state value carried in the event payload. The state machine block only defines which event-name → state-transition pairs are LEGAL.

**Why:** I learned this the hard way on 2026-05-20 building the framing module. The state machine declared `Stage.intake -> Stage.cutting_materials on started_cutting`, but my `started_cutting` event payload didn't include a `stage` field. Grove rejected the transition with `Z4001: policy violation: invalid state transition for 'stage': intake -> intake on event started_cutting v1` — because the projection never received a new state value, so the stage stayed at intake. The airbnb reservation module solves this by declaring `event approved { status: String }` and emitting `status: "approved"` from the action's apply block.

**How to apply:** Every state-transition event in Grove needs a field for the state column (e.g. `stage: String` or `status: String`) in its payload, AND the action's `emit` block must set that field to the literal new-state value as a string. The state machine declaration prevents illegal transitions but doesn't write the field itself.
