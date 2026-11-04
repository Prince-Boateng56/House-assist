const CELL_SIZE = 55;
const INFLUENCE_RADIUS = 260;
const MAX_WARP = 24;
const DOT_SPACING = 28;
const LERP_SPEED = 0.08;
const FRAME_INTERVAL = 1000 / 30;

const SEA_BLUE = { r: 7, g: 91, b: 112 };
const ACTIVE_BLUE = { r: 11, g: 113, b: 133 };
const LINE_BASE = { ...SEA_BLUE, a: 0.065 };
const NODE_BASE = { ...SEA_BLUE, a: 0.18 };
const NODE_BASE_RADIUS = 1.35;
const NODE_ACTIVE_RADIUS = 3.1;

const lerp = (a, b, t) => a + (b - a) * t;

function colorMix(base, active, amount) {
  const t = Math.max(0, Math.min(1, amount));
  const r = Math.round(lerp(base.r, active.r, t));
  const g = Math.round(lerp(base.g, active.g, t));
  const b = Math.round(lerp(base.b, active.b, t));
  const a = lerp(base.a, active.a, t);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

export function mountKineticGrid(canvas, landing) {
  const ctx = canvas?.getContext("2d", { alpha: true });
  if (!ctx || !landing) return () => {};

  const pointer = { x: -9999, y: -9999 };
  const target = { x: -9999, y: -9999 };
  const ripples = [];
  const size = { width: 0, height: 0, pixelRatio: 1 };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frameId = 0;
  let lastFrameAt = 0;
  let active = false;

  const isVisible = () =>
    !landing.classList.contains("hide") && document.visibilityState !== "hidden";

  function warpPoint(gx, gy, col, row, cols, rows) {
    const pin = Math.min(
      col / 1.5,
      (cols - 1 - col) / 1.5,
      row / 1.5,
      (rows - 1 - row) / 1.5,
      1,
    );
    const pinFactor = Math.max(0, pin) ** 4;
    const dx = gx - pointer.x;
    const dy = gy - pointer.y;
    const distance = Math.hypot(dx, dy);
    const proximity = Math.max(0, 1 - distance / INFLUENCE_RADIUS) * pinFactor;

    let rippleX = 0;
    let rippleY = 0;
    for (const ripple of ripples) {
      const rdx = gx - ripple.x;
      const rdy = gy - ripple.y;
      const rippleDistance = Math.hypot(rdx, rdy);
      const difference = rippleDistance - ripple.radius;
      const waveWidth = 55;
      if (Math.abs(difference) < waveWidth) {
        const strength =
          (1 - Math.abs(difference) / waveWidth) * ripple.opacity * 18 * pinFactor;
        const angle = Math.atan2(rdy, rdx);
        const sign = difference < 0 ? -1 : 1;
        rippleX += Math.cos(angle) * strength * sign * -1;
        rippleY += Math.sin(angle) * strength * sign * -1;
      }
    }

    if (distance < INFLUENCE_RADIUS && distance > 0 && pinFactor > 0) {
      const t = distance / INFLUENCE_RADIUS;
      const eased = t < 0.01 ? 0 : (1 - t) ** 2 * Math.min(1, distance / 60);
      const warp = eased * MAX_WARP * pinFactor;
      const angle = Math.atan2(dy, dx);
      return {
        x: gx - Math.cos(angle) * warp + rippleX,
        y: gy - Math.sin(angle) * warp + rippleY,
        proximity,
      };
    }

    return { x: gx + rippleX, y: gy + rippleY, proximity };
  }

  function draw(now) {
    const { width, height } = size;
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);

    // A quiet, static dot texture stays visible between interactions.
    ctx.fillStyle = "rgba(7,91,112,.10)";
    for (let x = DOT_SPACING / 2; x < width; x += DOT_SPACING) {
      for (let y = DOT_SPACING / 2; y < height; y += DOT_SPACING) {
        ctx.beginPath();
        ctx.arc(x, y, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      const ripple = ripples[i];
      const age = (now - ripple.born) / 1000;
      ripple.radius = Math.max(0, age * 400);
      ripple.opacity = Math.max(0, 1 - age * 1.2);
      if (ripple.opacity <= 0) ripples.splice(i, 1);
    }

    const cols = Math.max(2, Math.ceil(width / CELL_SIZE)) + 1;
    const rows = Math.max(2, Math.ceil(height / CELL_SIZE)) + 1;
    const cellWidth = width / (cols - 1);
    const cellHeight = height / (rows - 1);
    const points = [];

    for (let row = 0; row < rows; row += 1) {
      points[row] = [];
      for (let col = 0; col < cols; col += 1) {
        points[row][col] = warpPoint(col * cellWidth, row * cellHeight, col, row, cols, rows);
      }
    }

    const drawSegment = (a, b) => {
      const average = (a.proximity + b.proximity) / 2;
      const eased = average * average * (3 - 2 * average);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = colorMix(LINE_BASE, { ...ACTIVE_BLUE, a: 0.68 }, eased);
      ctx.lineWidth = lerp(0.7, 1.4, eased);
      ctx.stroke();
    };

    ctx.lineCap = "round";
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols - 1; col += 1) {
        drawSegment(points[row][col], points[row][col + 1]);
      }
    }
    for (let col = 0; col < cols; col += 1) {
      for (let row = 0; row < rows - 1; row += 1) {
        drawSegment(points[row][col], points[row + 1][col]);
      }
    }

    for (const row of points) {
      for (const point of row) {
        const eased = point.proximity ** 2 * (3 - 2 * point.proximity);
        const radius = lerp(NODE_BASE_RADIUS, NODE_ACTIVE_RADIUS, eased);
        if (eased > 0.3) {
          const glowRadius = radius + lerp(0, 6, (eased - 0.3) / 0.7);
          const glow = ctx.createRadialGradient(
            point.x,
            point.y,
            radius * 0.5,
            point.x,
            point.y,
            glowRadius,
          );
          glow.addColorStop(0, `rgba(${ACTIVE_BLUE.r},${ACTIVE_BLUE.g},${ACTIVE_BLUE.b},${(eased * 0.2).toFixed(3)})`);
          glow.addColorStop(1, `rgba(${ACTIVE_BLUE.r},${ACTIVE_BLUE.g},${ACTIVE_BLUE.b},0)`);
          ctx.beginPath();
          ctx.arc(point.x, point.y, glowRadius, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = colorMix(NODE_BASE, { ...ACTIVE_BLUE, a: 0.82 }, eased);
        ctx.fill();
      }
    }

    for (const ripple of ripples) {
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, Math.max(0, ripple.radius), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${ACTIVE_BLUE.r},${ACTIVE_BLUE.g},${ACTIVE_BLUE.b},${(ripple.opacity * 0.3).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function schedule() {
    if (!active || frameId || reducedMotion.matches) return;
    frameId = requestAnimationFrame(animate);
  }

  function animate(now) {
    frameId = 0;
    if (!active || !isVisible()) return;
    if (now - lastFrameAt < FRAME_INTERVAL) {
      schedule();
      return;
    }
    lastFrameAt = now;

    pointer.x = lerp(pointer.x, target.x, LERP_SPEED);
    pointer.y = lerp(pointer.y, target.y, LERP_SPEED);
    if (Math.abs(pointer.x - target.x) < 0.35) pointer.x = target.x;
    if (Math.abs(pointer.y - target.y) < 0.35) pointer.y = target.y;
    draw(now);

    const pointerMoving = Math.abs(pointer.x - target.x) > 0.35 || Math.abs(pointer.y - target.y) > 0.35;
    if (pointerMoving || ripples.length) schedule();
  }

  function resize() {
    size.width = window.innerWidth;
    size.height = window.innerHeight;
    size.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * size.pixelRatio);
    canvas.height = Math.round(size.height * size.pixelRatio);
    ctx.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
    draw(performance.now());
  }

  function onPointerMove(event) {
    target.x = event.clientX;
    target.y = event.clientY;
    schedule();
  }

  function onPointerDown(event) {
    if (!active || reducedMotion.matches) return;
    target.x = event.clientX;
    target.y = event.clientY;
    ripples.push({ x: event.clientX, y: event.clientY, radius: 0, opacity: 1, born: performance.now() });
    if (ripples.length > 5) ripples.shift();
    schedule();
  }

  function onPointerOut(event) {
    if (event.relatedTarget === null) {
      target.x = -9999;
      target.y = -9999;
      schedule();
    }
  }

  function syncVisibility() {
    const shouldRun = isVisible();
    if (shouldRun && !active) {
      active = true;
      draw(performance.now());
      if (!reducedMotion.matches) schedule();
    } else if (!shouldRun && active) {
      active = false;
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      ripples.length = 0;
    }
  }

  const onMotionChange = () => {
    if (reducedMotion.matches) {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      draw(performance.now());
    } else {
      schedule();
    }
  };

  const landingObserver = new MutationObserver(syncVisibility);
  landingObserver.observe(landing, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointerout", onPointerOut, { passive: true });
  document.addEventListener("visibilitychange", syncVisibility);
  reducedMotion.addEventListener?.("change", onMotionChange);
  resize();
  syncVisibility();

  return () => {
    active = false;
    if (frameId) cancelAnimationFrame(frameId);
    landingObserver.disconnect();
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerout", onPointerOut);
    document.removeEventListener("visibilitychange", syncVisibility);
    reducedMotion.removeEventListener?.("change", onMotionChange);
  };
}

const canvas = document.getElementById("haKineticGrid");
const landing = document.getElementById("land");
if (canvas && landing) mountKineticGrid(canvas, landing);
