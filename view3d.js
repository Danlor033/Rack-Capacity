// The rack, drawn. Drag to turn it, scroll to come closer, right-drag to slide
// the view sideways. Every box is one instance of the same cube, so a rack
// holding twenty thousand small cartons still turns smoothly.
const View3D = (function () {
  "use strict";

  const COLORS = ["#2f6fed", "#f0982c", "#17a673", "#e05260", "#8b5cf6", "#0ea5b7"];
  const MAX_INSTANCES = 20000;

  let renderer = null, scene = null, camera = null, canvas = null;
  let boxMesh = null, rackLines = null, floor = null;
  let center = new THREE.Vector3();
  let radius = 400, theta = Math.PI * 0.25, phi = Math.PI * 0.32;
  let pan = new THREE.Vector3();
  let needsDraw = true;

  function available() {
    return typeof THREE !== "undefined";
  }

  function init(el) {
    canvas = el;
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, 1, 20000);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa4b2, 0.95));
    const key = new THREE.DirectionalLight(0xffffff, 0.65);
    key.position.set(1, 1.6, 0.9);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-1, 0.4, -0.8);
    scene.add(fill);

    bindPointer();
    new ResizeObserver(resize).observe(canvas.parentElement);
    resize();
    requestAnimationFrame(loop);
  }

  function resize() {
    if (!renderer) return;
    const box = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(1, Math.floor(box.width));
    const h = Math.max(1, Math.floor(box.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    needsDraw = true;
  }

  function bindPointer() {
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
      if (canvas.hasPointerCapture && e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) {
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
  }

  function loop() {
    requestAnimationFrame(loop);
    if (!needsDraw || !renderer) return;
    needsDraw = false;
    const sinPhi = Math.sin(phi);
    camera.position.set(
      center.x + pan.x + radius * sinPhi * Math.sin(theta),
      center.y + pan.y + radius * Math.cos(phi),
      center.z + pan.z + radius * sinPhi * Math.cos(theta)
    );
    camera.lookAt(center.x + pan.x, center.y + pan.y, center.z + pan.z);
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
    rackLines.position.set(0, 0, 0);
    scene.add(rackLines);

    const plane = new THREE.Mesh(
      new THREE.BoxGeometry(rack.l, Math.max(1, rack.h * 0.012), rack.w),
      new THREE.MeshLambertMaterial({ color: dark ? 0x2b3443 : 0xd7dde7 })
    );
    plane.position.set(0, -rack.h / 2, 0);
    floor = plane;
    scene.add(floor);
  }

  // placements are in rack space: x along the length, y along the width,
  // z upward, each measured from the near bottom-left corner.
  function show(rack, placements, dark) {
    if (!renderer) return 0;

    center.set(0, 0, 0);
    drawRack(rack, dark);
    clear(boxMesh);
    boxMesh = null;

    const shown = Math.min(placements.length, MAX_INSTANCES);
    if (shown > 0) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
      boxMesh = new THREE.InstancedMesh(geo, mat, shown);
      boxMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

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
        boxMesh.setColorAt(i, color.set(COLORS[p.oi % COLORS.length]));
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

  return {
    available: available,
    init: init,
    show: show,
    frame: frame,
    colors: COLORS,
    max: MAX_INSTANCES,
    redraw: function () { needsDraw = true; },
  };
})();
