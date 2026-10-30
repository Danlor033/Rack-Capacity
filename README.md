# Rack Planner

Two things in one page:

- **Racks** — the SKU list, and every SKU's shelf in the 4KB racks: which
  shelf, how many boxes, and how they sit on it.
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

### The SKU list

The list lives at the top of the Racks page, under **SKU**. Each SKU has
a Tier, Category, SKU code, Sold per day, Quantity, Length, Width, Height
(cm) and Qty per box.

- **Categories.** One button per category, biggest first, says how many SKUs
  it has and how many of those need something filled in. Clicking one opens
  its SKUs in a window over the page, best seller (sold per day) first.
  *All categories* lists every SKU, and the filter in the window narrows
  either view. A shelf opened from the window shows on top of it; Esc closes
  the shelf, then the window.
- **+ Add SKU** opens a form. SKU code and category are required, and a code
  already in the list is refused. The category box starts on the category
  being shown, and suggests the ones that exist.
- **Removing** a SKU is not possible from the page.
- **Shelves.** Each category button, and the top of its window, says how
  many shelves the category takes; the *Shelves* column says it per SKU.
  Shelves are picked in the *Locations* column (see below).
- **Editing.** *L*, *W*, *H* and *Qty per box* are edited in place. *Sold
  per day* and *Quantity* are shown but not editable; they are set when the
  SKU is added. A change is saved the moment it is committed (Enter,
  Tab, or clicking away) and the racks are laid out again at once. An empty
  box that is keeping a SKU off the racks -- usually *Qty per box* -- is
  outlined. Tier, category and SKU code cannot be edited; remove the SKU and
  add it again.

**Sold per day comes from a Google Sheet**, *Shigetsu sold per day*
(SKU in column A, sold per day in column D). The page reads it when it
opens, then every minute while it is in view and whenever it comes back
into view. A number that changed is used at once and saved to the SKU, so
the last one is kept if the sheet cannot be reached. The line under the
page title links the sheet and says when it was last checked.

- The sheet must stay shared as *anyone with the link can view*; that is
  what lets a browser read it without a Google sign-in. If it is made
  private, the page says it cannot read it and keeps the saved numbers.
- SKUs are matched by code, ignoring case. The sheet is copied as it is:
  an empty cell in column D empties Sold/Day too (Needed and Boxes become 0).
  A SKU that is not in the sheet at all keeps its saved number.
- Which sheet and columns: `soldsheet.js`.

Two numbers are worked out, not typed:

- **Needed qty** = *Sold per day × days*, where days is a setting on the
  Racks page (15 to start with).
- **Boxes** = *4KB Qty ÷ Qty per box*, **rounded up** -- a part-full
  carton still takes a whole carton's room on the shelf. Shelf Needed
  (Boxes ÷ Per Shelf) comes from these. Needed (sales) is shown beside
  them but does not change the box count.
- **No shelf** = Boxes less the boxes already on shelves. Locations can be
  added while any are left, whatever the sales say. The 4KB Qty itself
  comes from JSTERP (see below).

Other PCs see a change the next time they load the page.

The list started as an imported Excel sheet. The Import page has since been
taken out; `excel.js` still has the reader in case it is ever wanted back.

### Choosing shelves

Nothing is placed automatically. Each SKU's shelves are picked by hand, in
the *Locations* column of the SKU list:

- **+ Select location** opens the rack map for that SKU: vacant shelves
  outlined green, occupied ones in their SKU's colour, and the SKU's own
  shelves ringed. Clicking a shelf asks the **quantity to move** there:
  up to what is still without a shelf, and no more than the room on that
  shelf holds. The quantity becomes boxes rounded up (500 qty at 195 a box
  is 3 boxes). Locations picked before 2026-10-30 have no quantity and take
  as many boxes as fit.
- An **occupied** shelf is shared: a window lists what is already on it
  and asks before the SKU goes in beside them. Choices are worked through in the order they were
  made; each SKU puts as many of its boxes as fit in the room still free on
  the shelf, in a slice front to back, full height. A shelf with no room
  left for at least one of the SKU's boxes is shown hatched as *Full* and
  cannot be picked. A location that ends up with no room anyway (the SKU
  before it filled the shelf later, say after its qty per box was set) is
  tagged *no room* in red, for deleting.
- **+ Select location** is greyed out, with the reason on hover, when the
  SKU has nothing left under *No shelf*, or its boxes cannot be counted or
  fitted yet (no Qty/Box, no L/W/H, box bigger than a shelf, none needed).
- A SKU can have as many shelves as it needs; its boxes fill them in the
  order they were picked. Boxes left over show under *No shelf* (in red),
  and the SKU is marked *needs more shelves* (or *pick a location*).
- Each location shows the boxes and qty this SKU has there, *mixed* when
  the shelf is shared, a copy button for the label, and an **×** that takes
  this SKU off the shelf after a confirmation window (anything else on it
  stays).

Choices are saved for everyone, in the `rack_shelves` table: one row per SKU
on a shelf.

The list's columns, after #, Tier, Category and SKU: 4KB Qty, Sold/Day,
Needed, Qty/Box, Boxes, Per Shelf, Shelf Needed (Boxes ÷ Per Shelf, rounded
up), Placed, No shelf, L, W, H, Locations.

**Days of stock in 4KB** (beside **+ Add SKU**) sets Needed: *Sold per day ×
days*. Boxes may be turned any way to fit a shelf.

Until 2026-10-29 the app chose shelves itself, from rules (who goes first,
best shelves, sharing). That was taken out; it is in the git history before
this change if it is ever wanted back.

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
  Labels show the rack's length, width and height, and one outlined box of
  each orientation has its own **L** (red), **W** (green) and **H** (blue) on
  the edges they run along -- so a box lying on its side reads at a glance.
  Each orientation is labelled at a different corner. The shelf window on
  the Racks page does the same, per SKU.
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

That copy only works for people already on the same network; the online
copy below works from anywhere. Windows Firewall already allows this `pythonw.exe` inbound
on the Public profile. If the network is ever reclassified Private or Domain,
that allowance will need repeating for the new profile.

Note that `serve.py` throws its request log away. Under `pythonw.exe` there
is no console, so there is no `sys.stderr` for the usual logging to write to,
and the attempt would break the request halfway through.

### Releasing a change

Every script and the stylesheet are loaded as `name.js?v=...` from
`index.html`. **Change that version whenever any `.js` or `.css` file
changes.** A browser that already holds an older copy of a file will
otherwise go on using it beside the new page -- which is exactly how an
import once failed with *Cannot read properties of undefined (reading
'save')*: a new import page talking to yesterday's `db.js`.

`serve.py` also sends `Cache-Control: no-cache`, so the page itself is
always checked for a newer copy.

### Online: Cloudflare Pages

The same files are also published at <https://rack-planner-acce.pages.dev>
(Cloudflare Pages project `rack-planner-acce`, account Ops.shigetsu).
`rack-planner.pages.dev` itself belongs to somebody else.

The project is connected to this GitHub repository, so **every push to
`main` goes online by itself** within a minute or so. Cloudflare builds it
with `mkdir -p dist && cp index.html style.css _headers *.js dist/` and
serves `dist`, so `serve.py`, the shortcut script and this README stay off
the site. Both
copies use the same Supabase project, so they show the same racks and sheet.

`deploy.cmd` is the manual way, for a change that is not pushed. It copies only what
the browser needs (`index.html`, `style.css`, the `.js` files and
`_headers`) into `dist`, then uploads that with Wrangler. The first time on a
PC, sign in once with `npx.cmd wrangler login`. Use `npx.cmd`, not `npx`:
PowerShell refuses to run `npx.ps1` on this PC.

`_headers` gives the online copy the same `Cache-Control: no-cache` as
`serve.py`, so the version rule above still applies.

Anyone who has the address can open the online copy, and the page can change
the data as well as read it -- see the note in the next section.

## Live changes between users

Every open page keeps a live connection to Supabase (Realtime). When anybody
adds a SKU, edits its numbers, picks or deletes a location, or changes the
days of stock, every other page showing the racks redraws with it within a
second or two, with no reload. Open windows (a category, the location
picker, a shelf) stay open, and a number being typed is never overwritten.

- The line under the page title shows a green dot and *Live* while
  connected. If the connection drops it reconnects by itself, and meanwhile
  the page checks for changes every 20 seconds.
- The tables on the live channel: rack_skus, rack_shelves, rack_imports,
  rack_sync (Supabase publication supabase_realtime).
- The client library is supabase-js 2.45.4, loaded from jsDelivr.

## 4KB Qty from JSTERP

The 4KB Qty comes from JSTERP, **Warehouse > Zone Inventory** with owner
Shigetsu, warehouse area Main Warehouse and start position 4KB. Each SKU's
locations are added together; a SKU with nothing there gets 0.

JSTERP only answers someone signed in to it (its login is encrypted and can
ask for a captcha), so no server can read it on its own. Instead
`jstsync.js` runs **inside a signed-in JSTERP tab**, started from a bookmark:

1. On the Racks page, click **Set up** in the 4KB Qty line under the title
   and drag the *Rack Planner 4KB sync* button to the bookmarks bar.
2. Sign in to JSTERP and open Zone Inventory
   (`https://asia.jsterp.com/Wms/Pack/PackItem` -- the page itself, not the
   asia-web menu around it; the bookmark offers to go there).
3. Click the bookmark. A box in the corner shows each run. Leave the tab
   open -- best on a PC that is always on. One tab serves everybody.

Every 30 seconds it reads the list, writes any 4KB Qty that changed into
`rack_skus`, and leaves a note in `rack_sync` (name `jsterp-4kb`). Every
Racks page shows that note under the title, live, and turns it orange when
the last one is over two minutes old or the run failed (signed out of
JSTERP, usually: sign in and click the bookmark again).

The bookmark always loads `jstsync.js` from the online copy
(rack-planner-acce.pages.dev): JSTERP is https and will not run a script
from the office's plain-http address. The JSTERP filter ids (owner
Shigetsu = LinkCoIds 12697134 / LinkWarehouseIds 3948, warehouse 3938) are
at the top of `jstsync.js`.

## Sharing through Supabase

Without Supabase, the saved racks, box sizes and imported sheet live in the
browser, which is enough for one person. To share them, create the tables
and point the app at the project:

1. Run [`sql/schema.sql`](sql/schema.sql) in the Supabase SQL editor.
2. Put that project's URL and **publishable** key into `config.js`.

The app notices by itself. Note that the tables are reachable with the publishable key by
anyone who can open the page; `sql/schema.sql` explains the trade and what to
change if the app ever gains a login.

## The files

| File | What it holds |
| --- | --- |
| `packer.js` | How many boxes fit in a space, and where. No DOM -- testable on its own. |
| `layout.js` | The 4KB rows, columns, layers and labels, and the fill orders. |
| `allocate.js` | How many of a SKU's boxes go on each shelf it was given. No DOM -- testable on its own. |
| `excel.js` | The put-away export (SheetJS). Also an unused sheet reader, from when there was an Import page. |
| `jstsync.js` | Not loaded by the app: run in a JSTERP tab from a bookmark, it copies the 4KB Qty from Zone Inventory every 30 seconds. |
| `soldsheet.js` | Reads sold per day from the Google Sheet (column D, by the SKU in column A). |
| `dashboard.js` | The racks page: map, shelf detail, SKU list by category, adding and removing SKUs, rules. |
| `pages.js` | Switching between Racks and Calculator. |
| `view3d.js` | The 3D rack, on three.js. One instanced cube per box. |
| `view2d.js` | The calculator's plan view, on a plain 2D canvas. |
| `db.js` | Racks, presets and the SKU list, through Supabase or this browser. |
| `app.js` | The calculator page. |
| `config.js` | Where Supabase goes, if you use it. |
| `serve.py` | The server for this PC and the office network. |
