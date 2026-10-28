# Rack Planner

Two things in one page:

- **Racks** — import the SKU sheet and see every SKU's shelf in the 4KB
  racks: which shelf, how many boxes, and how they sit on it.
- **Calculator** — type one box size, get how many fit in a rack and how.

Every shelf is 240 × 120 × 85 cm (L × W × H).

## The 4KB racks

| Row | Columns | Layers | Shelves |
| --- | --- | --- | --- |
| 1 | 14 | 3 | 42 |
| 2 – 8 | 9 each | 3 | 189 |
| | | | **231** |

Each shelf is labelled `4KB-row-column-layer`: `4KB-1-1-1` is Row 1,
Column 1, Layer 1, and Layer 1 is the floor. The layout lives in
[`layout.js`](layout.js) -- add a row or change a column count there.

### Importing the SKU sheet

The Import page takes `.xlsx` or `.xls` with these columns, in any order:
Tier, Category, SKU, Sold per day, Quantity, Length, Width, Height,
Needed qty in 4KB for 15 days, Qty per box, Total number of boxes.

- Headers can sit below a title row, and close spellings are recognised
  (`Item Code`, `L (cm)`, `Pcs/Box`, `No. of Boxes` ...). The page shows which
  header it matched to which column before anything is saved.
- **Boxes to place** come from *Total number of boxes*. Where that is blank,
  *Needed qty for 15 days ÷ Qty per box*, rounded up.
- Sizes are read as centimetres.
- Saving a sheet replaces the previous one for everybody. The Import page has
  a template to download.

### How shelves are chosen

SKUs are taken in priority order and each takes the best shelves still free.
A SKU first fills as many whole shelves as its boxes can. Its leftover boxes
then get a slice of a shelf -- front to back, full height, only as wide as
they need -- and slices from different SKUs sit side by side. Nothing is
stacked on, or hidden behind, another SKU: every SKU on a shelf faces the
aisle.

Four rules, set on the dashboard and saved with the sheet so every PC sees
the same racks:

| Rule | Choices |
| --- | --- |
| Who goes first | Tier then sold per day · Category then tier · Sold per day only |
| Best shelves | Layer 1 everywhere, then 2, then 3 · Row by row · Label order |
| Sharing a shelf | Same category only · Any SKU · Never (one SKU per shelf) |
| Turning boxes | Any way up · Upright only |

Where each SKU lands is worked out in the browser from the sheet and these
rules, never stored, so a rule change shows at once.

**Export put-away list** writes an Excel file with two sheets: shelf by
shelf in walking order, and SKU by SKU with every shelf it went to and why
anything could not be placed.

## The calculator

### What it works out

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

### The two views

- **3D** — the rack with every box in place, coloured by orientation. Drag to
  turn it, scroll to zoom, shift-drag to slide. The slider fills the rack from
  the bottom up, so you can watch it build.
- **Plan** — the rack from above, cut through at the slider's height. This is
  the drawing to hand to somebody on the floor.

## Running it

There is no build step -- it is a folder of files and any static web server
will do. On the machine that hosts it, `serve.py` is that server:

```bash
python serve.py
```

Then open <http://localhost:8794>.

### Keeping it running on one PC

On OLT-0285 it starts by itself. Two shortcuts do it:

| Shortcut | Where it lives | What it does |
| --- | --- | --- |
| `Rack Planner server` | the Startup folder | Runs `pythonw serve.py` at sign-in -- no window, no terminal. |
| `Rack Planner` | the Desktop | Runs `open-rack-planner.vbs`: opens the app, first starting the server if nothing is serving. |

`serve.py` listens on every address, so other machines on the office network
reach it too:

- <http://OLT-0285:8794> -- the host name, which does not change
- <http://10.2.11.31:8794> -- the address today, which DHCP may change

Nothing is published to the internet; this only works for people already on
the same network. Windows Firewall already allows this `pythonw.exe` inbound
on the Public profile. If the network is ever reclassified Private or Domain,
that allowance will need repeating for the new profile.

Note that `serve.py` throws its request log away. Under `pythonw.exe` there
is no console, so there is no `sys.stderr` for the usual logging to write to,
and the attempt would break the request halfway through.

## Sharing through Supabase

Without Supabase, the saved racks, box sizes and imported sheet live in the
browser, which is enough for one person. To share them, create the tables
and point the app at the project:

1. Run [`sql/schema.sql`](sql/schema.sql) in the Supabase SQL editor.
2. Put that project's URL and **publishable** key into `config.js`.

The app notices by itself — the line under the title says which of the two it
is using. Note that the tables are reachable with the publishable key by
anyone who can open the page; `sql/schema.sql` explains the trade and what to
change if the app ever gains a login.

## The files

| File | What it holds |
| --- | --- |
| `packer.js` | How many boxes fit in a space, and where. No DOM -- testable on its own. |
| `layout.js` | The 4KB rows, columns, layers and labels, and the fill orders. |
| `allocate.js` | Which SKU goes on which shelf. No DOM -- testable on its own. |
| `excel.js` | Reading the SKU sheet, the template, and the put-away export (SheetJS). |
| `dashboard.js` | The racks page: map, shelf detail, SKU list, rules. |
| `importer.js` | The import page. |
| `pages.js` | Switching between Racks, Import and Calculator. |
| `view3d.js` | The 3D rack, on three.js. One instanced cube per box. |
| `view2d.js` | The calculator's plan view, on a plain 2D canvas. |
| `db.js` | Racks, presets and imported sheets, through Supabase or this browser. |
| `app.js` | The calculator page. |
| `config.js` | Where Supabase goes, if you use it. |
| `serve.py` | The server for this PC and the office network. |
