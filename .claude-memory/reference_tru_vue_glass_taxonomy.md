---
name: reference-tru-vue-glass-taxonomy
description: Tru Vue's 6-type glass+acrylic taxonomy is the de facto industry vocabulary for picture framing glazing
metadata:
  type: reference
---

**Tru Vue** at `https://tru-vue.com/` is the dominant manufacturer of picture-framing glazing. Their 6-product taxonomy is the canonical vocabulary used by distributors (Larson-Juhl etc.), POS systems, and framers.

**The six canonical products:**

| Product | Material | UV | Anti-reflective | Shatter-resistant | Tier |
|---|---|---|---|---|---|
| Basic Picture Frame Glass | Glass, 2.0mm | — | — | — | Commodity |
| Conservation Clear® Glass | Glass | 99% | — | — | Mid |
| Museum Glass® | Glass, 2.5mm | 99% | Yes (<1% reflection) | — | Premium |
| Standard Plexiglass | Acrylic | — | — | Yes | Commodity |
| Conservation Clear® Acrylic | Acrylic | 99% | — | Yes | Mid |
| Optium Museum Acrylic® | Acrylic | 99% | Yes | Yes (+ abrasion + anti-static) | Premium |

**Adjacent class (not in the six but used in shops):** non-glare glass — matte/etched surface, optically hazy, cheap. NOT the same as Museum Glass's anti-reflective coating.

**Verifiable UV standard:** Tru Vue Conservation Grade products block ≥97% of UV in the 300–380 nm range and are considered "photo-safe" per ISO 18902.

**Why this is in memory:** when evaluating Verso's `GlassKind` enum, or proposing schema changes around glazing, or interpreting a paper ticket scan that mentions a glass tier, the right taxonomy is Tru Vue's. Don't invent names; use these.

**Key page for refresh:** `https://tru-vue.com/knowledge-hub/education/6-types-of-picture-framing-glass-best-use-cases/`
