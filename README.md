# Rack Planner

Type a box size, get the number that fits in a rack, and see how they go in.
The default rack is 240 × 120 × 85 cm (L × W × H).

## What it works out

Given a rack and a box, it searches for the arrangement that holds the most
boxes. It does that by filling a solid grid of boxes in one orientation, then
cutting the leftover space three different ways and solving each piece the
same way, trying every orientation at each step. Mixing orientations is often
worth a lot: a 40 × 30 × 25 carton in the standard rack holds **78** boxes
mixed, against 72 if every box stands the same way up.

Three rules are available:

| Rule | What it allows |
| --- | --- |
| Any way up | All six rotations. Highest count. |
| Upright only | Height stays height; the footprint may turn. For "this side up" cartons. |
| Exactly as typed | No rotation at all. |

Alongside the count it reports how much of the rack's volume is used, how many
boxes stand on the shelf itself, how high the stack reaches, and — if you say
how many boxes you have — how many racks that needs.

## The two views

- **3D** — the rack with every box in place, coloured by orientation. Drag to
  turn it, scroll to zoom, shift-drag to slide. The slider fills the rack from
  the bottom up, so you can watch it build.
- **Plan** — the rack from above, cut through at the slider's height. This is
  the drawing to hand to somebody on the floor.

## Running it

Any static web server will do; there is no build step.

```bash
python -m http.server 8794
```

Then open <http://localhost:8794>.

## Saved racks and box sizes

Out of the box the two lists live in the browser, which is enough for one
person. To share them, create the tables and point the app at the project:

1. Run [`sql/schema.sql`](sql/schema.sql) in the Supabase SQL editor.
2. Put that project's URL and **publishable** key into `config.js`.

The app notices by itself — the line under the title says which of the two it
is using. Note that the tables are reachable with the publishable key by
anyone who can open the page; `sql/schema.sql` explains the trade and what to
change if the app ever gains a login.

## The files

| File | What it holds |
| --- | --- |
| `packer.js` | The search. No DOM, no dependencies — it can be tested on its own. |
| `view3d.js` | The 3D rack, on three.js. One instanced cube per box. |
| `view2d.js` | The plan view, on a plain 2D canvas. |
| `db.js` | The two lists, through Supabase or through this browser. |
| `app.js` | The wiring between the form, the numbers and the views. |
| `config.js` | Where Supabase goes, if you use it. |
