// The rack, drawn. Drag to turn it, scroll to come closer, shift-drag to slide
// the view sideways. Every box is one instance of the same cube, so a rack
// holding twenty thousand small cartons still turns smoothly.
//
// View3D.create(canvas) gives one independent view; the calculator and the
// racks dashboard each have their own.
const View3D = (function () {
  "use strict";

  const COLORS = ["#2f6fed", "#f0982c", "#17a673", "#e05260", "#8b5cf6", "#0ea5b7"];
  const MAX_INSTANCES = 20000;

  function available() {
    return typeof THREE !== "undefined";
  }

  function create(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 1, 20000);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa4b2, 0.95));
    const key = new THREE.DirectionalLight(0xffffff, 0.65);
    key.position.set(1, 1.6, 0.9);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-1, 0.4, -0.8);
    scene.add(fill);

    let boxMesh = null, rackLines = null, floor = null, marks = null;
    let radius = 400, theta = Math.PI * 0.25, phi = Math.PI * 0.32;
    const pan = new THREE.Vector3();
    let needsDraw = true;

    function resize() {
      const box = canvas.parentElement.getBoundingClientRect();
      const w = Math.max(1, Math.floor(box.width));
      const h = Math.max(1, Math.floor(box.height));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      needsDraw = true;
    }

    // Pointer: turn, slide, zoom.
    let dragging = null, lastX = 0, lastY = 0;

    canvas.addEventListener("pointerdown", function (e) {
      dragging = e.button === 2 || e.shiftKey ? "pan" : "turn";
      lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (dragging === "turn") {
        theta -= dx * 0.008;
        phi = Math.min(Math.PI - 0.08, Math.max(0.08, phi - dy * 0.008));
      } else {
        const scale = radius * 0.0016;
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        pan.addScaledVector(right, -dx * scale);
        pan.addScaledVector(up, dy * scale);
      }
      needsDraw = true;
    });

    const stop = function (e) {
      dragging = null;
      if (e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      radius = Math.min(6000, Math.max(30, radius * (e.deltaY > 0 ? 1.1 : 0.9)));
      needsDraw = true;
    }, { passive: false });

    // Labels: plain HTML tags over the canvas, each pinned to a point in the
    // scene and moved there every time the view is drawn. They stay sharp at
    // any zoom and never catch the mouse.
    const tagLayer = document.createElement("div");
    tagLayer.className = "v3d-tags";
    canvas.parentElement.appendChild(tagLayer);
    let tags = [];
    const projected = new THREE.Vector3();

    function setTags(list) {
      tagLayer.innerHTML = "";
      tags = list.map(function (t) {
        const node = document.createElement("span");
        node.className = "v3d-tag " + (t.cls || "");
        node.textContent = t.text;
        if (t.title) node.title = t.title;
        tagLayer.appendChild(node);
        return { node: node, at: t.at };
      });
    }

    function placeTags() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      for (const t of tags) {
        projected.copy(t.at).project(camera);
        const off = projected.z > 1 || projected.z < -1;
        t.node.style.display = off ? "none" : "";
        if (!off) {
          t.node.style.transform = "translate(" + ((projected.x + 1) / 2 * w).toFixed(1) + "px," +
            ((1 - projected.y) / 2 * h).toFixed(1) + "px) translate(-50%,-50%)";
        }
      }
    }

    function loop() {
      requestAnimationFrame(loop);
      if (!needsDraw) return;
      needsDraw = false;
      const sinPhi = Math.sin(phi);
      camera.position.set(
        pan.x + radius * sinPhi * Math.sin(theta),
        pan.y + radius * Math.cos(phi),
        pan.z + radius * sinPhi * Math.cos(theta)
      );
      camera.lookAt(pan.x, pan.y, pan.z);
      renderer.render(scene, camera);
      placeTags();
    }

    function clear(obj) {
      if (!obj) return;
      scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
      }
    }

    // The rack itself: an open wire cage with a solid shelf at the bottom.
    function drawRack(rack, dark) {
      clear(rackLines);
      clear(floor);

      const geo = new THREE.BoxGeometry(rack.l, rack.h, rack.w);
      rackLines = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: dark ? 0x7d8aa0 : 0x415066, transparent: true, opacity: 0.85 })
      );
      geo.dispose();
      scene.add(rackLines);

      floor = new THREE.Mesh(
        new THREE.BoxGeometry(rack.l, Math.max(1, rack.h * 0.012), rack.w),
        new THREE.MeshLambertMaterial({ color: dark ? 0x2b3443 : 0xd7dde7 })
      );
      floor.position.set(0, -rack.h / 2, 0);
      scene.add(floor);
    }

    // Which of the box's own sides -- L, W, H -- runs along each axis of the
    // rack for a box turned to (along, across, up). Sides of equal size are
    // told apart by taking each one once, in L, W, H order.
    function sidesOf(turned, own) {
      const left = [["L", own.l], ["W", own.w], ["H", own.h]];
      return turned.map(function (v) {
        const i = left.findIndex((d) => Math.abs(d[1] - v) < 1e-6);
        return i < 0 ? "?" : left.splice(i, 1)[0][0];
      });
    }

    // The colours of the box's own sides, the same as their tags (style.css).
    const SIDE_COLORS = { L: 0xd6453d, W: 0x1f8f4e, H: 0x2f6fed, "?": 0x8a93a5 };
    const UP = new THREE.Vector3(0, 1, 0);

    // The marks are drawn over everything, never hidden behind a box: the
    // dark rim first, then the colour on top of it.
    function overlay(color, order) {
      return [new THREE.MeshBasicMaterial({ color: color, depthTest: false, depthWrite: false }), order];
    }

    // A round bar from a to b, with a dark rim so it stands out against a
    // box of much the same colour.
    function rod(group, a, b, r, color) {
      const len = a.distanceTo(b);
      if (len < 1e-6) return;
      const dir = new THREE.Vector3().subVectors(b, a).normalize();
      const turn = new THREE.Quaternion().setFromUnitVectors(UP, dir);
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      [[r * 1.7].concat(overlay(0x111827, 10)), [r].concat(overlay(color, 11))].forEach(function (part) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(part[0], part[0], len + part[0], 12), part[1]);
        bar.position.copy(mid);
        bar.quaternion.copy(turn);
        bar.renderOrder = part[2];
        group.add(bar);
      });
    }

    function dot(group, at, r, color) {
      [[r * 1.4].concat(overlay(0x111827, 12)), [r].concat(overlay(color, 13))].forEach(function (part) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(part[0], 16, 12), part[1]);
        ball.position.copy(at);
        ball.renderOrder = part[2];
        group.add(ball);
      });
    }

    // The rack's own size along its three edges, and on one box of each
    // kind (each SKU, or each way it is turned) which side is L, W and H: the
    // box nearest the starting view, outlined, its three edges at one corner
    // drawn in their side's colour, the corner marked, and a line from each
    // edge out to its tag.
    function label(rack, placements, opts) {
      if (marks) {
        scene.remove(marks);
        marks.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        marks = null;
      }
      if (!opts) { setTags([]); return; }
      const fmt = opts.fmt || ((cm) => Math.round(cm * 10) / 10 + " cm");
      const what = opts.what || "Rack";
      const at = (x, y, z) => new THREE.Vector3(x - rack.l / 2, z - rack.h / 2, y - rack.w / 2);
      const out = Math.max(rack.l, rack.w, rack.h) * 0.05;
      // Just outside and below the two near bottom edges, and beside the
      // upright at the left, so they stay clear of the boxes and each other.
      const list = [
        { at: at(rack.l * 0.18, rack.w + out, -out), text: what + " length " + fmt(rack.l), cls: "v3d-rack" },
        { at: at(rack.l + out, rack.w * 0.3, -out), text: what + " width " + fmt(rack.w), cls: "v3d-rack" },
        { at: at(-out, rack.w, rack.h / 2), text: what + " height " + fmt(rack.h), cls: "v3d-rack" },
      ];

      if (opts.dims) {
        // One labelled box per kind: per SKU when the boxes belong to SKUs
        // (opts.group), otherwise per way the box is turned. Each kind gets a
        // corner of its own -- near right, near left, far right, far left --
        // and its highest box there, so the tags of two kinds stay apart.
        const CORNERS = [[1, 1], [0, 1], [1, 0], [0, 0]];
        const kindOf = (p) => (opts.group ? "g" + opts.group(p) : "o" + p.oi);
        const kinds = [];
        for (const p of placements) {
          const key = kindOf(p);
          if (kinds.indexOf(key) < 0) kinds.push(key);
        }
        const pick = new Map();
        for (const p of placements) {
          const key = kindOf(p);
          const k = kinds.indexOf(key);
          if (k >= CORNERS.length) continue;
          const c = CORNERS[k];
          const reach = (c[0] ? p.x + p.l : -p.x) + (c[1] ? p.y + p.w : -p.y) + p.z + p.h;
          const best = pick.get(key);
          if (!best || reach > best.reach) pick.set(key, { p: p, reach: reach, c: c });
        }
        marks = new THREE.Group();
        const lineMat = new THREE.LineBasicMaterial({ color: opts.dark ? 0xffffff : 0x111827 });
        const big = Math.max(rack.l, rack.w, rack.h);
        [...pick.values()].forEach(function (b) {
          const p = b.p;
          const own = opts.dims(p);
          if (!own) return;
          const sides = sidesOf([p.l, p.w, p.h], own);
          const geo = new THREE.BoxGeometry(p.l, p.h, p.w);
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat);
          geo.dispose();
          edges.position.copy(at(p.x + p.l / 2, p.y + p.w / 2, p.z + p.h / 2));
          marks.add(edges);
          // The corner on its side where the three labelled edges meet; each
          // tag sits out from the middle of its edge, away from the box, with
          // a line back to it.
          const r = Math.max(0.3, Math.min(big * 0.0065, Math.min(p.l, p.w, p.h) * 0.08));
          const d = Math.max(Math.min(p.l, p.w, p.h) * 0.6, big * 0.04);
          const ex = b.c[0] ? p.x + p.l : p.x, ey = b.c[1] ? p.y + p.w : p.y, z1 = p.z + p.h;
          const sx = b.c[0] ? 1 : -1, sy = b.c[1] ? 1 : -1;
          const edge = [
            // [edge from, edge to, tag at, side, size, how it runs]
            [at(p.x, ey, z1), at(p.x + p.l, ey, z1), at(p.x + p.l / 2, ey + sy * d, z1 + d),
              sides[0], p.l, "along the " + what.toLowerCase() + "'s length"],
            [at(ex, p.y, z1), at(ex, p.y + p.w, z1), at(ex + sx * d, p.y + p.w / 2, z1 + d),
              sides[1], p.w, "across the " + what.toLowerCase() + "'s width"],
            [at(ex, ey, p.z), at(ex, ey, z1), at(ex + sx * d, ey + sy * d, p.z + p.h / 2),
              sides[2], p.h, "upright"],
          ];
          for (const e of edge) {
            const color = SIDE_COLORS[e[3]] || SIDE_COLORS["?"];
            rod(marks, e[0], e[1], r, color);
            rod(marks, new THREE.Vector3().addVectors(e[0], e[1]).multiplyScalar(0.5), e[2], r * 0.55, color);
            list.push({ at: e[2], text: e[3] + " " + fmt(e[4]), cls: "v3d-side v3d-" + e[3],
              title: "The box's " + ({ L: "length", W: "width", H: "height" }[e[3]] || "side") + " runs " + e[5] });
          }
          dot(marks, at(ex, ey, z1), r * 2.2, 0xffffff);
        });
        scene.add(marks);
      }
      setTags(list);
    }

    // placements are in rack space: x along the length, y along the width,
    // z upward, each measured from the near bottom-left corner. A placement
    // carrying its own `color` is drawn in it; otherwise the colour says
    // which way up the box stands. opts, for the labels: { what ("Rack" or
    // "Shelf"), fmt(cm) -> text, dims(p) -> the box's own { l, w, h },
    // group(p) -> which SKU it belongs to, dark }.
    function show(rack, placements, dark, opts) {
      drawRack(rack, dark);
      clear(boxMesh);
      boxMesh = null;
      label(rack, placements.slice(0, MAX_INSTANCES), opts ? Object.assign({ dark: dark }, opts) : null);

      const shown = Math.min(placements.length, MAX_INSTANCES);
      if (shown > 0) {
        boxMesh = new THREE.InstancedMesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshLambertMaterial(),
          shown
        );

        const m = new THREE.Matrix4();
        const color = new THREE.Color();
        const gap = 0.97;

        for (let i = 0; i < shown; i++) {
          const p = placements[i];
          m.makeScale(p.l * gap, p.h * gap, p.w * gap);
          m.setPosition(
            p.x + p.l / 2 - rack.l / 2,
            p.z + p.h / 2 - rack.h / 2,
            p.y + p.w / 2 - rack.w / 2
          );
          boxMesh.setMatrixAt(i, m);
          boxMesh.setColorAt(i, color.set(p.color || COLORS[p.oi % COLORS.length]));
        }
        boxMesh.instanceMatrix.needsUpdate = true;
        if (boxMesh.instanceColor) boxMesh.instanceColor.needsUpdate = true;
        scene.add(boxMesh);
      }

      needsDraw = true;
      return shown;
    }

    // Back to the starting view, far enough out for the whole rack; closer
    // is a fraction of that (1 = the usual distance).
    function frame(rack, closer) {
      radius = Math.max(rack.l, rack.w, rack.h) * 1.9 * (closer || 1);
      theta = Math.PI * 0.25;
      phi = Math.PI * 0.32;
      pan.set(0, 0, 0);
      needsDraw = true;
    }

    new ResizeObserver(resize).observe(canvas.parentElement);
    resize();
    requestAnimationFrame(loop);

    return {
      show: show,
      frame: frame,
      redraw: function () { needsDraw = true; },
    };
  }

  return {
    available: available,
    create: create,
    colors: COLORS,
    max: MAX_INSTANCES,
  };
})();
