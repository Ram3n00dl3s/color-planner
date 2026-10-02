import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * "Simple shapes" doodle backdrop — an OPTIONAL, very faint field of plain
 * geometry (circles, squares, triangles, diamonds, pluses, hexagons, rings,
 * dots, crosses) that lingers behind the calendar and the timer column.
 *
 * Why a DOM layer instead of the SVG mask every other style uses?
 * The other doodle styles are painted through a CSS `mask-image`. Animations
 * authored *inside* an SVG that is used as a mask/background image do not run
 * (the image is rasterized once), so to make shapes drift we have to render them
 * as real nodes and animate them with CSS keyframes.
 *
 * The motion is deliberately almost imperceptible: each shape sits perfectly
 * still for most of its (long) cycle and only eases a few pixels away and back
 * once — so at any moment only a couple of shapes are quietly moving. Positions
 * and timings are seeded, so the layout never jitters between renders.
 *
 * Neutral only: shapes are drawn with `currentColor` (the layer sets it to
 * `var(--text-normal)`) at the shared doodle opacity — no accents, no borders.
 */

type ShapeKind =
    | 'circle'
    | 'ring'
    | 'square'
    | 'triangle'
    | 'diamond'
    | 'plus'
    | 'hexagon'
    | 'dot'
    | 'cross';

type ShapeVariant = 'drift' | 'sway' | 'breathe' | 'grow';

/**
 * How one shape takes part in the ambient stir. Everything here is seeded, so a
 * shape keeps the same temperament for as long as it is on screen: the point is
 * that no two shapes ever move together.
 */
interface ShapeReact {
    gain: number; // 0.45–1.35 — how much of the shared energy this shape takes on
    ease: number; // 0.03–0.11 — how quickly it wakes and settles (per 1/60s)
    freqX: number; // rad/s — the slower the wave, the lazier the drift
    freqY: number;
    freqSpin: number;
    phaseX: number; // rad — offsets so the waves never line up
    phaseY: number;
    phaseSpin: number;
}

interface PlacedShape {
    kind: ShapeKind;
    left: number; // % of layer width
    top: number; // % of layer height
    size: number; // px
    rot: number; // deg (base rotation)
    variant: ShapeVariant;
    dur: number; // s
    delay: number; // s, applied as a negative delay to desync
    depth: number; // 0.45–1.6 — how far this shape travels when the field stirs
    react: ShapeReact;
}

const KINDS: ShapeKind[] = ['circle', 'ring', 'square', 'triangle', 'diamond', 'plus', 'hexagon', 'dot', 'cross'];
const VARIANTS: ShapeVariant[] = ['drift', 'sway', 'breathe', 'grow'];
// Long, uneven durations so no two shapes ever settle into a visible rhythm.
const DURATIONS = [44, 53, 61, 72, 83, 97, 111];

// The field is laid out on a fixed, jittered grid that is big enough to satisfy
// the maximum shape amount; the "amount" setting simply reveals a prefix of it.
const GRID_COLS = 12;
const GRID_ROWS = 8;
const MAX_SLOTS = GRID_COLS * GRID_ROWS;

// The field always carries exactly one fish, however the "amount" slider is set.
// It is drawn at the same scale as the shapes, so the size setting governs it too.
const FISH_SIZE = 58;

/** The knobs the caller can turn. All are clamped before they get here. */
export interface ShapesBackdropConfig {
    /** How many shapes to scatter across the layer. */
    count: number;
    /** Multiplier applied to every shape's size (1 = the neutral baseline). */
    sizeScale?: number;
    /** Outline weight of the geometry, in SVG user units. */
    strokeWidth?: number;
    /** Degrees to spin the entire field by, around its centre. */
    rotation?: number;
    /**
     * How far the shapes sit from the centre, as a multiplier. 1 = the neutral
     * scatter, above 1 spreads them apart, below 1 draws them together.
     */
    spread?: number;
}

/** Deterministic 0..1 pseudo-random so the field is stable across renders. */
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/**
 * Build the shape field. A single jittered grid is generated once, then shuffled
 * deterministically, so raising the "amount" slider only ever *adds* shapes —
 * the ones already on screen never jump around — and the layout is identical on
 * every render.
 */
function makeShapes(count: number): PlacedShape[] {
    const rand = rng(1337);
    const slots: PlacedShape[] = [];
    // A dense grid with sizeable shapes: less dead space, so the field still
    // reads in light mode where a hairline outline can otherwise vanish.
    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            const jx = (rand() - 0.5) * 0.8;
            const jy = (rand() - 0.5) * 0.8;
            const left = ((c + 0.5 + jx) / GRID_COLS) * 100;
            const top = ((r + 0.5 + jy) / GRID_ROWS) * 100;
            slots.push({
                kind: KINDS[Math.floor(rand() * KINDS.length)],
                left: Math.max(1, Math.min(99, left)),
                top: Math.max(1, Math.min(99, top)),
                size: 34 + Math.round(rand() * 70),
                rot: Math.round((rand() - 0.5) * 50),
                variant: VARIANTS[Math.floor(rand() * VARIANTS.length)],
                dur: DURATIONS[Math.floor(rand() * DURATIONS.length)],
                delay: Math.round(rand() * 120),
                // Deeper shapes travel further, and every shape gets its own energy
                // gain, its own ease, and its own wave phases and directions — so
                // the field stirs like a flock, never like one rigid body.
                depth: 0.45 + rand() * 1.15,
                react: {
                    // A deliberately wide spread on both knobs: some shapes wake almost
                    // at once and swing furthest, others lag well behind — which is what
                    // keeps the field from ever moving as one body.
                    gain: 0.35 + rand() * 1.0,
                    ease: 0.025 + rand() * 0.095,
                    freqX: 0.45 + rand() * 0.6,
                    freqY: 0.45 + rand() * 0.6,
                    freqSpin: 0.5 + rand() * 0.8,
                    phaseX: rand() * Math.PI * 2,
                    phaseY: rand() * Math.PI * 2,
                    phaseSpin: rand() * Math.PI * 2
                }
            });
        }
    }
    // Deterministic Fisher–Yates shuffle: a given amount always yields the same
    // field, and larger amounts are strict supersets of smaller ones.
    for (let i = slots.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = slots[i];
        slots[i] = slots[j];
        slots[j] = tmp;
    }
    const wanted = Math.max(1, Math.min(MAX_SLOTS, Math.round(count)));
    return slots.slice(0, wanted);
}

/**
 * Push every slot away from — or draw it toward — the centre of the field. The
 * spread setting turns this dial; a light clamp keeps the outermost shapes from
 * travelling absurdly far past the edges.
 */
function applySpread(base: PlacedShape[], spread: number): PlacedShape[] {
    if (spread === 1) return base;
    const place = (v: number) => Math.max(-15, Math.min(115, 50 + (v - 50) * spread));
    return base.map(s => ({ ...s, left: place(s.left), top: place(s.top) }));
}

/** Per-shape re-layout pace and beat, derived from the shape's own tempo so a
 *  re-scatter ripples through the field instead of moving as one body. */
const glideSeconds = (s: PlacedShape) => (1.9 + ((s.dur - 44) / 67) * 1.7).toFixed(2);
const glideStagger = (s: PlacedShape) => (((s.delay % 10) / 10) * 0.45).toFixed(2);

/** The inner geometry for one shape, drawn on a 0..100 viewBox. */
function shapeNode(kind: ShapeKind) {
    switch (kind) {
        case 'circle':
            return <circle cx="50" cy="50" r="43" />;
        case 'ring':
            return (
                <>
                    <circle cx="50" cy="50" r="43" />
                    <circle cx="50" cy="50" r="19" />
                </>
            );
        case 'square':
            return <rect x="10" y="10" width="80" height="80" rx="10" />;
        case 'triangle':
            return <polygon points="50,9 91,87 9,87" />;
        case 'diamond':
            return <polygon points="50,7 93,50 50,93 7,50" />;
        case 'plus':
            return <path d="M50 10 V90 M10 50 H90" />;
        case 'hexagon':
            return <polygon points="50,7 88,28 88,72 50,93 12,72 12,28" />;
        case 'cross':
            return <path d="M18 18 L82 82 M82 18 L18 82" />;
        case 'dot':
            return <circle cx="50" cy="50" r="11" fill="currentColor" stroke="none" />;
    }
}

/**
 * Neutral companion to the mask-based doodles: a floating field of plain shapes
 * whose amount, size, rotation and stroke are all user-tunable.
 *
 * The field is also *reactive*, so it reads as something living in the room
 * rather than a picture pasted on the glass:
 *   • Scroll — every shape trails the grid a little and then springs back, each
 *     at its own depth, so the field feels like it is trying to stay in view; a
 *     sideways scroll also gives each shape a faint sway.
 *   • Drag — while a tile, a timer or a fresh event is being dragged, the shapes
 *     within reach of the pointer ease out of its way.
 *
 * The layer also carries a single fish: a simplified shape drawn like the rest,
 * but with a course of its own. It cruises the whole field at a slow, even pace,
 * steering around the other shapes and easing off the walls, and it never stops.
 *
 * All of it is written straight to the DOM from a single rAF loop, so scrolling
 * and dragging never cost a React re-render. The loop idles back to sleep once the
 * reactions settle — only the fish keeps it awake.
 */
export const ShapesBackdrop = ({ count, sizeScale = 1, strokeWidth = 4, rotation = 0, spread = 1 }: ShapesBackdropConfig) => {
    const [shapes, setShapes] = useState<PlacedShape[]>(() => makeShapes(count));
    const layerRef = useRef<HTMLDivElement | null>(null);
    const reactRefs = useRef<(HTMLSpanElement | null)[]>([]);
    const fishRef = useRef<HTMLSpanElement | null>(null);
    // The fish's course — where it is and which way it is pointing. It lives in a
    // ref rather than in state because it changes every frame and is written
    // straight to the DOM, so React never re-renders for it. Holding it across
    // effect restarts means nudging a setting can never teleport the fish.
    const fishState = useRef({ x: 0, y: 0, heading: 0, placed: false });

    // Grow/shrink the field when the amount changes. The base layout is a
    // deterministic superset, so shapes already on screen keep their slot — only
    // new ones appear, and nothing already placed jumps.
    const lastCount = useRef(count);
    useEffect(() => {
        if (lastCount.current === count) return;
        lastCount.current = count;
        setShapes(makeShapes(count));
    }, [count]);

    // Where the shapes actually sit once the spread dial is applied. Rendering and
    // the pointer-reaction maths both read this, so they always agree.
    const placedShapes = useMemo(() => applySpread(shapes, spread), [shapes, spread]);

    // Rotating an axis-aligned layer would bare its corners, so the layer is
    // scaled by exactly the factor needed to keep covering its box at that angle
    // (1 at 0°/90°, √2 at 45°). Each shape is counter-scaled by the same factor,
    // so the size slider keeps meaning what it says however the field is spun.
    const rad = (rotation * Math.PI) / 180;
    const cover = (Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad))) * 1.02;

    /**
     * The reaction engine — an *ambient stir*, not a directional shove.
     *
     * Scrolling never aims the field anywhere: it just hands the field energy, and
     * each shape then spends that energy in its own time and its own direction
     * (its own gain, its own ease, two out-of-step sine waves per axis, so shapes
     * wander instead of tracking one shared line). The energy bleeds away slowly,
     * so the field melts back into its built-in idle motion rather than snapping
     * home the moment the scrolling stops.
     *
     * All of this is measured in the layer's own pre-transform space, so the
     * rotation/cover transform stays out of the maths: the pointer is mapped back
     * through the inverse transform once per frame and compared with each shape's
     * layout position.
     */
    useEffect(() => {
        const layer = layerRef.current;
        if (!layer) return;

        // Park the fish first: with "reduce motion" on it then simply stays put as a
        // still silhouette in the field, just like the shapes around it.
        const fish = fishRef.current;
        const fishHalf = (FISH_SIZE * sizeScale / cover) / 2;
        const course = fishState.current;
        if (!course.placed) {
            course.placed = true;
            course.x = (layer.offsetWidth || 1) * 0.62;
            course.y = (layer.offsetHeight || 1) * 0.38;
            course.heading = -0.12;
        }
        const writeFish = (wiggleDeg = 0) => {
            if (!fish) return;
            const deg = (course.heading * 180) / Math.PI + wiggleDeg;
            fish.style.transform = `translate3d(${(course.x - fishHalf).toFixed(2)}px, ${(course.y - fishHalf).toFixed(2)}px, 0) rotate(${deg.toFixed(2)}deg)`;
        };
        writeFish();

        // Respect the OS "reduce motion" preference: leave the field — and the fish —
        // perfectly still.
        if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        // Both scrollers (the grid and the timer column) live in the layer's own
        // parent, so that is the boundary we answer to.
        const root = layer.parentElement;
        const scrollMemo = new WeakMap<EventTarget, { top: number; left: number }>();
        const n = placedShapes.length;

        const AMP = 8; // px — the loudest any one shape's ambient sway gets
        const SPIN = 2.2; // deg — the loudest any one shape's ambient turn gets
        const BLEED = 0.98; // share of the shared energy kept per 1/60s
        const STIR_STEP = 0.012; // energy gained per px scrolled
        const STIR_MAX = 0.55; // a flick of the wheel tops the field out around here
        const STIR_SHOW = 0.35; // share of STIR_MAX that counts as "stirred"
        const REACH = 300; // px — how far away a shape can feel the pointer
        const PUSH = 28; // px — largest nudge away from the pointer
        const DRAG_STIR = 0.55; // share of STIR_MAX the whole field holds while a drag is live
        const REST = 0.0025; // below this the scene is entirely still

        // The fish's own dials. It is deliberately the slowest thing in the layer.
        const FISH_SPEED = 14; // px per second — a slow, even cruise
        const FISH_TURN = 0.5; // rad per second — the tightest turn it will take
        const FISH_FEEL = 110; // px — how far off it notices a shape to steer around
        const FISH_EDGE = 72; // px — the margin it eases away from the walls

        // Per-shape envelopes, so no two shapes ever wake, peak or settle together.
        const env = new Float64Array(n);
        const pushX = new Float64Array(n);
        const pushY = new Float64Array(n);

        let stir = 0; // shared energy, 0..STIR_MAX
        let strength = 0; // 0 → 1 pointer influence, ramped so nothing snaps
        let pointer: { x: number; y: number } | null = null;
        let armed: { x: number; y: number } | null = null; // pressed but not yet moved
        let dragging = false;
        let clock = 0; // seconds — keeps every shape's waves in phase across frames
        let last = 0; // previous frame's timestamp, for an honest delta
        let raf = 0;
        let running = false;

        const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

        const draw = (now: number) => {
            raf = 0;
            // A real delta, so the stir feels the same on a 60Hz and a 120Hz screen and
            // a background tab waking up can't jolt the field. `frames` normalises every
            // easing below to "per 1/60s".
            const dt = last ? clamp((now - last) / 1000, 0.004, 0.05) : 1 / 60;
            last = now;
            clock += dt;
            const frames = dt * 60;

            stir *= Math.pow(BLEED, frames);
            // Moving a tile around is a hands-on action, so the whole field stays
            // quietly alert for as long as the drag lasts — not just the shapes the
            // pointer happens to be near.
            if (dragging) stir = Math.max(stir, STIR_MAX * DRAG_STIR);
            if (!dragging && stir < REST) stir = 0;
            strength += ((dragging ? 1 : 0) - strength) * Math.min(1, 0.1 * frames);

            const rect = layer.getBoundingClientRect();
            const w = layer.offsetWidth || 1;
            const h = layer.offsetHeight || 1;
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;

            // Map the pointer from client space back into the layer's own space.
            let px = 0;
            let py = 0;
            let hasPointer = false;
            if (pointer && strength > 0.004) {
                const dx = (pointer.x - cx) / cover;
                const dy = (pointer.y - cy) / cover;
                px = dx * Math.cos(rad) + dy * Math.sin(rad) + w / 2;
                py = -dx * Math.sin(rad) + dy * Math.cos(rad) + h / 2;
                hasPointer = true;
            }

            // Anything still visibly moving keeps the loop alive.
            let alive = strength;

            placedShapes.forEach((s, i) => {
                const node = reactRefs.current[i];
                if (!node) return;
                const r = s.react;
                // Each shape takes the shared energy on — and lets go of it — at its own
                // pace. This one line is what stops the field lurching as a single body.
                const rate = Math.min(1, r.ease * frames);
                env[i] += (stir * r.gain - env[i]) * rate;

                // Two slow, out-of-step waves per axis: the shape curls through a lazy
                // drift, never a straight line and never in lockstep with a neighbour.
                // Deeper shapes swing a little wider.
                const amp = AMP * env[i] * s.depth;
                const tx = amp * Math.sin(clock * r.freqX + r.phaseX);
                const ty = amp * Math.sin(clock * r.freqY + r.phaseY);
                const spin = SPIN * env[i] * Math.sin(clock * r.freqSpin + r.phaseSpin);

                // The pointer push is eased per shape too, so they don't all flinch at once.
                let goalX = 0;
                let goalY = 0;
                let scale = 1;
                if (hasPointer) {
                    const ox = (s.left / 100) * w - px;
                    const oy = (s.top / 100) * h - py;
                    const dist = Math.hypot(ox, oy) || 1;
                    if (dist < REACH) {
                        const f = 1 - dist / REACH;
                        const ease = f * f * (3 - 2 * f); // smoothstep, so there's no hard edge
                        const mag = (ease * PUSH * strength) / dist;
                        goalX = ox * mag;
                        goalY = oy * mag;
                        scale = 1 + ease * 0.05 * strength * r.gain; // and lean away a touch
                    }
                }
                pushX[i] += (goalX - pushX[i]) * rate;
                pushY[i] += (goalY - pushY[i]) * rate;

                const ox2 = tx + pushX[i];
                const oy2 = ty + pushY[i];
                if (Math.abs(ox2) + Math.abs(oy2) + Math.abs(spin) + Math.abs(scale - 1) * 20 < 0.06) {
                    node.style.transform = ''; // home already — nothing worth painting
                    return;
                }
                alive = Math.max(alive, Math.abs(env[i]), Math.abs(ox2), Math.abs(oy2));
                node.style.transform = `translate3d(${ox2.toFixed(2)}px, ${oy2.toFixed(2)}px, 0) rotate(${spin.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
            });

            // --- the fish: the one shape that never sits still --------------------
            // It cruises at a slow, even pace and steers *around* the other shapes
            // rather than through them. Every influence here is gentle — a squared
            // falloff for the shapes, a soft push off the walls, and a capped turn
            // rate — so its course is always a long, calm curve, never a dart.
            {
                // The heading wanders: one full sweep about every two minutes,
                // carried by two out-of-step sines so the path keeps meandering.
                const wander = clock * 0.05
                    + 1.05 * Math.sin(clock * 0.043)
                    + 0.65 * Math.sin(clock * 0.017 + 1.3);
                let steerX = Math.cos(wander);
                let steerY = Math.sin(wander);

                for (let i = 0; i < n; i++) {
                    const s = placedShapes[i];
                    const dx = course.x - (s.left / 100) * w;
                    const dy = course.y - (s.top / 100) * h;
                    const dist = Math.hypot(dx, dy) || 1;
                    if (dist < FISH_FEEL) {
                        // Squared falloff: the other shapes are a nudge, not a wall.
                        const weight = (1 - dist / FISH_FEEL) ** 2 * 2.2;
                        steerX += (dx / dist) * weight;
                        steerY += (dy / dist) * weight;
                    }
                }

                if (course.x < FISH_EDGE) steerX += (1 - course.x / FISH_EDGE) * 1.6;
                else if (course.x > w - FISH_EDGE) steerX -= (1 - (w - course.x) / FISH_EDGE) * 1.6;
                if (course.y < FISH_EDGE) steerY += (1 - course.y / FISH_EDGE) * 1.6;
                else if (course.y > h - FISH_EDGE) steerY -= (1 - (h - course.y) / FISH_EDGE) * 1.6;

                // Turn towards the steered heading at a capped rate, the short way
                // round, so the fish banks through its turns instead of pivoting.
                const goal = Math.atan2(steerY, steerX);
                const diff = Math.atan2(Math.sin(goal - course.heading), Math.cos(goal - course.heading));
                course.heading += clamp(diff, -FISH_TURN * dt, FISH_TURN * dt);

                course.x += Math.cos(course.heading) * FISH_SPEED * dt;
                course.y += Math.sin(course.heading) * FISH_SPEED * dt;

                // Belt and braces: the steering above should keep it inside, but a
                // hard clamp guarantees the fish can never be clipped by the layer.
                const inset = fishHalf + 2;
                course.x = clamp(course.x, inset, Math.max(inset, w - inset));
                course.y = clamp(course.y, inset, Math.max(inset, h - inset));

                // A barely-there tail-beat, so it never reads as a pasted-on decal.
                writeFish(Math.sin(clock * 1.15) * 2.2);
            }

            // The faint lift only shows while the stir actually has strength in it, so a
            // long tail-off can't leave the field looking brighter than it should.
            layer.classList.toggle('is-scrolling', !dragging && stir > STIR_MAX * STIR_SHOW);
            layer.classList.toggle('is-dragging', dragging);

            // The fish never settles, so while one is on screen the loop stays up.
            if (alive < REST && !fish) {
                layer.classList.remove('is-scrolling', 'is-dragging');
                placedShapes.forEach((_, i) => {
                    const node = reactRefs.current[i];
                    if (node) node.style.transform = '';
                });
                running = false;
                last = 0;
                return;
            }
            raf = requestAnimationFrame(draw);
        };

        const ensureRunning = () => {
            if (running) return;
            running = true;
            last = 0; // restart the clock without counting the idle gap
            raf = requestAnimationFrame(draw);
        };

        // --- scroll: scrolling hands the field energy; it never aims it -----------
        const onScroll = (e: Event) => {
            const el = e.target as HTMLElement | null;
            if (!el || typeof el.scrollTop !== 'number') return;
            if (root && !root.contains(el)) return; // scrolling somewhere else in Obsidian
            if (!layer.offsetWidth) return; // hidden (another doodle style is active)
            const top = el.scrollTop;
            const left = el.scrollLeft;
            const prev = scrollMemo.get(el) || { top, left };
            scrollMemo.set(el, { top, left });
            // Direction is deliberately ignored: scrolling is a stir, not a shove, so
            // the field must never appear to be dragged off in one direction.
            const moved = Math.abs(top - prev.top) + Math.abs(left - prev.left);
            if (moved < 0.5) return;
            stir = clamp(stir + moved * STIR_STEP, 0, STIR_MAX);
            ensureRunning();
        };

        // --- drag: shapes within reach ease out of the pointer's way -------------
        const onPointerDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            const target = e.target as HTMLElement | null;
            if (target && target.closest('input, textarea, select, [contenteditable="true"]')) return;
            const rect = layer.getBoundingClientRect();
            if (!rect.width
                || e.clientX < rect.left || e.clientX > rect.right
                || e.clientY < rect.top || e.clientY > rect.bottom) return;
            armed = { x: e.clientX, y: e.clientY };
        };
        const onPointerMove = (e: PointerEvent) => {
            if (armed && !dragging) {
                // Wait for a real drag, so a plain click stays perfectly quiet.
                if (Math.hypot(e.clientX - armed.x, e.clientY - armed.y) < 5) return;
                dragging = true;
            }
            if (!dragging) return;
            pointer = { x: e.clientX, y: e.clientY };
            ensureRunning();
        };
        const onPointerUp = () => {
            armed = null;
            dragging = false;
            ensureRunning(); // let the loop ease the shapes home, then stop
        };

        document.addEventListener('scroll', onScroll, true);
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('pointermove', onPointerMove, true);
        document.addEventListener('pointerup', onPointerUp, true);
        document.addEventListener('pointercancel', onPointerUp, true);

        return () => {
            if (raf) cancelAnimationFrame(raf);
            running = false;
            document.removeEventListener('scroll', onScroll, true);
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('pointermove', onPointerMove, true);
            document.removeEventListener('pointerup', onPointerUp, true);
            document.removeEventListener('pointercancel', onPointerUp, true);
            layer.classList.remove('is-scrolling', 'is-dragging');
            reactRefs.current.forEach(node => { if (node) node.style.transform = ''; });
        };
    }, [placedShapes, cover, rad, sizeScale]);

    return (
        <div
            ref={layerRef}
            className="sleek-shapes-layer"
            aria-hidden="true"
            style={{ transform: `rotate(${rotation}deg) scale(${cover})` }}
        >
            {placedShapes.map((s, i) => (
                <span
                    key={i}
                    className={`sleek-shape sleek-shape--${s.variant}`}
                    style={{
                        left: `${s.left}%`,
                        top: `${s.top}%`,
                        width: `${(s.size * sizeScale) / cover}px`,
                        height: `${(s.size * sizeScale) / cover}px`,
                        animationDuration: `${s.dur}s`,
                        animationDelay: `-${s.delay}s`,
                        transitionDuration: `${glideSeconds(s)}s, ${glideSeconds(s)}s`,
                        transitionDelay: `${glideStagger(s)}s, ${glideStagger(s)}s`
                    }}
                >
                    {/* The idle keyframes own .sleek-shape's transform, so the
                        scroll/drag reaction is written to this inner wrapper — the
                        two can then never fight over `transform`. */}
                    <span className="sleek-shape-react" ref={el => { reactRefs.current[i] = el; }}>
                        <svg
                            viewBox="0 0 100 100"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={strokeWidth}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ display: 'block', width: '100%', height: '100%', transform: `rotate(${s.rot}deg)` }}
                        >
                            {shapeNode(s.kind)}
                        </svg>
                    </span>
                </span>
            ))}
            {/* The one shape that never sits still: a simplified fish, drawn in the
                same hairline ink as everything else. Its position and heading are
                written straight to `transform` by the loop above, so it costs no
                React re-render as it cruises the field. */}
            <span
                className="sleek-fish"
                ref={fishRef}
                style={{
                    width: `${(FISH_SIZE * sizeScale) / cover}px`,
                    height: `${(FISH_SIZE * sizeScale) / cover}px`
                }}
            >
                <svg
                    viewBox="0 0 100 100"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    {/* Body, tail, one eye — as plain as the rest of the field. */}
                    <path d="M24 50 C36 31 66 28 88 50 C66 72 36 69 24 50 Z" />
                    <path d="M24 50 L8 33 L12 50 L8 67 Z" />
                    <circle cx="73" cy="43" r="3" fill="currentColor" stroke="none" />
                </svg>
            </span>
        </div>
    );
};
