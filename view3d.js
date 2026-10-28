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

    let boxMesh = null, rackLines = null, floor = null;
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

    // placements are in rack space: x along the length, y along the width,
    // z upward, each measured from the near bottom-left corner. A placement
    // carrying its own `color` is drawn in it; otherwise the colour says
    // which way up the box stands.
    function show(rack, placements, dark) {
      drawRack(rack, dark);
      clear(boxMesh);
      boxMesh = null;

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

    function frame(rack) {
      radius = Math.max(rack.l, rack.w, rack.h) * 1.9;
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
