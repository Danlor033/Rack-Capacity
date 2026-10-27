// A plan view: the rack seen from above, cut through at one height. This is
// the drawing you can hand to somebody on the floor -- it says what the layer
// in front of them should look like.
const View2D = (function () {
  "use strict";

  // The boxes handed in are already the ones the cut passes through.
  function show(canvas, rack, slice, dark, colors) {
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const box = canvas.parentElement.getBoundingClientRect();
    const W = Math.max(1, Math.floor(box.width));
    const H = Math.max(1, Math.floor(box.height));
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const pad = 34;
    const scale = Math.min((W - pad * 2) / rack.l, (H - pad * 2) / rack.w);
    const ox = (W - rack.l * scale) / 2;
    const oy = (H - rack.w * scale) / 2;

    const ink = dark ? "#e6ebf2" : "#1f2937";
    const line = dark ? "#8392a7" : "#475569";

    // The rack footprint.
    ctx.fillStyle = dark ? "#1b2431" : "#f1f4f9";
    ctx.fillRect(ox, oy, rack.l * scale, rack.w * scale);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ox, oy, rack.l * scale, rack.w * scale);

    const small = slice.length > 260;

    for (const p of slice) {
      const x = ox + p.x * scale;
      const y = oy + p.y * scale;
      const w = p.l * scale;
      const h = p.w * scale;
      ctx.fillStyle = colors[p.oi % colors.length];
      ctx.globalAlpha = 0.82;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      if (!small) {
        ctx.strokeStyle = dark ? "rgba(10,14,20,0.55)" : "rgba(255,255,255,0.75)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
    }

    // Dimensions along the top and the left.
    ctx.fillStyle = ink;
    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(rack.l + " cm", ox + (rack.l * scale) / 2, oy - 12);
    ctx.save();
    ctx.translate(ox - 14, oy + (rack.w * scale) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(rack.w + " cm", 0, 0);
    ctx.restore();

    ctx.textAlign = "left";
    ctx.fillStyle = dark ? "#9fb0c6" : "#5b6878";
    ctx.fillText(slice.length + (slice.length === 1 ? " box" : " boxes") + " at this height", ox, oy + rack.w * scale + 20);

    return slice.length;
  }

  return { show: show };
})();
