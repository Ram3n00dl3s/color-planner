/**
 * Optional "doodle" backdrop — a small library of hand-drawn styles.
 *
 * Every style is drawn as a lightweight SVG and exposed to CSS as a *mask*
 * (see styles.css). The calendar paints the mask with `background-color:
 * var(--text-normal)`, so the lines automatically match whatever theme the user
 * has (dark or light) — they read as faint ink on the calendar, never as a
 * picture, and never as a colored accent.
 *
 * Two deliberate choices keep every style from being "an image in the
 * background":
 *
 * 1. ZOOM. Artwork is authored on a 1600×1600 grid but the mask is rendered at
 *    `DOODLE_TILE_SIZE` (2400px), i.e. blown up ~1.5×, and the tile repeats. A
 *    normal-sized week view therefore only ever shows fragments of each motif —
 *    a curve, a spiral arm, half a moon, a stray digit — never a whole legible
 *    object. It is never quite clear what the doodles are.
 * 2. OPACITY. The whole layer sits at a very low opacity (default 6%), so it
 *    lingers behind events and grid lines without competing for attention.
 *
 * The mask is composited twice at two different scales/offsets (see styles.css)
 * which breaks up the obvious repeat and gives the lines a loose, layered feel.
 *
 * Neutral colors only — the mask is pure alpha, so no accent (and definitely no
 * purple) is ever involved. No borders, no fills that read as UI.
 */

export interface DoodleStyleOption {
	value: string;
	label: string;
}

/** Every style offered in Settings → Calendar background → Doodle style. */
export const DOODLE_STYLES: DoodleStyleOption[] = [
	{ value: 'sketch', label: 'Sketch dump (mixed doodles)' },
	{ value: 'calendar', label: 'Hand-drawn calendar' },
	{ value: 'botanical', label: 'Botanical (plants & leaves)' },
	{ value: 'geometric', label: 'Geometric (abstract shapes)' },
	{ value: 'cosmic', label: 'Cosmic (night sky)' },
	{ value: 'shapes', label: 'Simple shapes (animated)' }
];

export const DEFAULT_DOODLE_STYLE = 'sketch';

/** Default faintness of the doodles, as a percentage (0–100 → CSS opacity 0–1). */
export const DEFAULT_DOODLE_OPACITY = 6;

/** Maximum the "Doodle intensity" slider is allowed to reach (kept subtle). */
export const MAX_DOODLE_OPACITY = 20;

/**
 * On-screen size of one doodle tile, in px. Larger = more zoomed in = the
 * doodles read as vaguer, closer crops of line art. This is the knob that makes
 * the feature feel like "lingering doodle lines" rather than a wallpaper.
 */
export const DOODLE_TILE_SIZE = 2400;

/** Design grid every style is authored on (SVG viewBox units). */
const DOODLE_TILE = 1600;

/* ----------------------------------------------------------------------------
 * Tiny drawing helpers. Everything returns SVG markup (stroke-only, so it works
 * directly as an alpha mask).
 * -------------------------------------------------------------------------- */

/** Five-point star outline centred on (cx, cy). */
function starPath(cx: number, cy: number, r: number): string {
	const pts: string[] = [];
	for (let i = 0; i < 10; i++) {
		const rr = i % 2 === 0 ? r : r * 0.46;
		const a = ((-90 + i * 36) * Math.PI) / 180;
		pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`);
	}
	return `M ${pts.join(' L ')} Z`;
}

/** Four-point "sparkle" star drawn with soft quadratic pinches. */
function sparklePath(cx: number, cy: number, r: number): string {
	const k = r * 0.16;
	return [
		`M ${cx} ${cy - r}`,
		`Q ${cx + k} ${cy - k} ${cx + r} ${cy}`,
		`Q ${cx + k} ${cy + k} ${cx} ${cy + r}`,
		`Q ${cx - k} ${cy + k} ${cx - r} ${cy}`,
		`Q ${cx - k} ${cy - k} ${cx} ${cy - r} Z`
	].join(' ');
}

/** A leaf outline (plus midrib) centred on (cx, cy), rotated by `rot` degrees. */
function leafPath(cx: number, cy: number, w: number, h: number, rot = 0): string {
	const body = `M ${cx} ${cy - h} C ${cx + w} ${cy - h * 0.55} ${cx + w} ${cy + h * 0.55} ${cx} ${cy + h} C ${cx - w} ${cy + h * 0.55} ${cx - w} ${cy - h * 0.55} ${cx} ${cy - h} Z`;
	const rib = `M ${cx} ${cy - h + 4} L ${cx} ${cy + h - 4}`;
	return `<g transform="rotate(${rot} ${cx} ${cy})"><path d="${body}" /><path d="${rib}" /></g>`;
}

/** A five-petal flower centred on (cx, cy). */
function flowerPath(cx: number, cy: number, r: number): string {
	let out = '';
	for (let i = 0; i < 5; i++) {
		const a = ((i * 72 - 90) * Math.PI) / 180;
		const px = cx + Math.cos(a) * r;
		const py = cy + Math.sin(a) * r;
		out += `<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${(r * 0.64).toFixed(1)}" ry="${(r * 0.42).toFixed(1)}" transform="rotate(${i * 72} ${px.toFixed(1)} ${py.toFixed(1)})" />`;
	}
	return `${out}<circle cx="${cx}" cy="${cy}" r="${(r * 0.32).toFixed(1)}" />`;
}

/** Deterministic 0..1 pseudo-random so a tile always looks the same. */
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

/* ----------------------------------------------------------------------------
 * Shared motif shapes, drawn once and placed by reference (used mostly by the
 * calendar style, where each cell holds a tiny doodle).
 * -------------------------------------------------------------------------- */

const HEART_D = 'M 380 610 C 250 500 170 430 178 336 C 185 250 300 226 380 312 C 460 226 575 250 582 336 C 590 430 510 500 380 610 Z';
const COFFEE_D = [
	'M 182 1112 C 250 1092 400 1092 462 1112',
	'M 198 1118 C 192 1214 214 1286 262 1296 L 382 1296 C 430 1286 452 1214 446 1118',
	'M 452 1150 C 522 1136 528 1226 452 1220',
	'M 150 1322 C 250 1352 400 1352 494 1322',
	'M 268 1062 C 248 1032 288 1012 268 982',
	'M 330 1058 C 310 1028 350 1008 330 978',
	'M 392 1062 C 372 1032 412 1012 392 982'
].join(' ');
const SPIRAL_D = 'M 1320 1160 C 1352 1120 1414 1132 1430 1184 C 1450 1252 1382 1310 1314 1300 C 1236 1288 1198 1202 1230 1136 C 1272 1048 1392 1038 1464 1106';
const STAR_D = starPath(0, 0, 96);
const SMILEY_D = `<circle cx="0" cy="0" r="86" /><path d="M -44 22 C -22 58 24 58 46 22" />`;
const EYE_D = `<path d="M -80 0 C -42 -46 42 -46 80 0 C 42 46 -42 46 -80 0 Z" /><circle cx="0" cy="0" r="28" /><path d="M -96 -18 L -116 -32 M -80 -40 L -92 -60 M -50 -52 L -54 -74" />`;
const GHOST_D = `<path d="M -58 66 C -58 -74 58 -74 58 66 C 40 44 22 76 0 54 C -22 76 -40 44 -58 66 Z" />`;
const QUESTION_D = `<path d="M -42 -26 C -42 -84 42 -84 42 -26 C 42 4 0 2 0 34" /><path d="M 0 74 L 0 80" />`;
const MOON_D = `<path d="M 34 -74 A 82 82 0 1 0 34 74 A 60 60 0 1 1 34 -74 Z" />`;
const ARROW_D = `<path d="M -74 42 C -24 -22 34 40 74 -12" /><path d="M 74 -12 L 42 -22 M 74 -12 L 80 22" />`;

/**
 * Place a motif, expressed in its own reference coordinates, at (cx, cy) scaled
 * so the motif's reference width becomes `size`.
 */
function place(d: string, refCx: number, refCy: number, refW: number, cx: number, cy: number, size: number, extraD = ''): string {
	const s = size / refW;
	return `<g transform="translate(${cx} ${cy}) scale(${s.toFixed(3)}) translate(${-refCx} ${-refCy})"><path d="${d}" />${extraD}</g>`;
}

/** Hand-drawn digit shapes (local box: x 0..70, baseline y 0, top y -88). */
const DIGIT_PATHS: Record<string, string> = {
	'1': 'M 14 0 L 32 -88 L 32 0 M 4 2 L 58 2',
	'2': 'M 8 -70 C 8 -100 62 -100 62 -70 C 62 -48 8 -40 8 0 L 64 0',
	'3': 'M 10 -78 C 28 -102 64 -92 46 -52 C 72 -60 68 4 14 0',
	'4': 'M 48 -88 L 6 -22 L 66 -22 M 46 -88 L 46 0',
	'5': 'M 60 -88 L 10 -88 L 6 -50 C 30 -62 66 -40 52 -6 C 40 12 10 6 6 -6',
	'6': 'M 52 -88 C 6 -66 4 8 30 2 C 66 -6 60 -48 24 -44 C 6 -42 6 -18 16 -8',
	'7': 'M 6 -88 L 64 -88 L 24 0',
	'8': 'M 34 -50 C 2 -50 4 -90 34 -88 C 64 -86 62 -52 34 -50 C 4 -48 4 6 34 2 C 64 -2 62 -52 34 -50',
	'9': 'M 58 -60 C 8 -62 12 -90 34 -88 C 62 -86 56 -18 20 2'
};

/** Draw a whole number in the hand-drawn digit style, centred on (cx, cy). */
function doodleNumber(n: number, cx: number, cy: number, size: number): string {
	const digits = String(n).split('');
	const scale = (size * 0.62) / 70;
	const spacing = 74 * scale;
	const totalW = (digits.length - 1) * spacing + 70 * scale;
	let out = `<g transform="translate(${(cx - totalW / 2).toFixed(1)} ${(cy + (88 * scale) / 2).toFixed(1)}) scale(${scale.toFixed(3)})" stroke-width="${(2.8 / scale).toFixed(2)}">`;
	digits.forEach((d, i) => {
		out += `<path d="${DIGIT_PATHS[d] || DIGIT_PATHS['1']}" transform="translate(${(i * 74).toFixed(1)} 0)" />`;
	});
	return `${out}</g>`;
}

/* ----------------------------------------------------------------------------
 * Style 1 — "Sketch dump". The original mixed bag of doodles.
 * -------------------------------------------------------------------------- */

const SKETCH_ART = `
	<g transform="rotate(-6 380 420)">
		<path d="${HEART_D}" />
	</g>
	<g transform="rotate(9 1230 337)">
		<path d="${starPath(1230, 337, 210)}" />
	</g>
	<g transform="rotate(-4 150 200)">
		<circle cx="150" cy="200" r="78" />
		<path d="M 150 70 L 150 96" />
		<path d="M 150 304 L 150 330" />
		<path d="M 20 200 L 46 200" />
		<path d="M 254 200 L 280 200" />
		<path d="M 58 108 L 76 126" />
		<path d="M 224 274 L 242 292" />
		<path d="M 242 108 L 224 126" />
		<path d="M 76 274 L 58 292" />
	</g>
	<g transform="rotate(7 700 200)">
		<path d="M 700 40 C 606 40 566 150 618 226 C 652 274 700 292 700 292 C 700 292 748 274 782 226 C 834 150 794 40 700 40 Z" />
		<path d="M 686 296 L 714 296 L 700 318 Z" />
		<path d="M 700 318 C 688 356 716 372 700 410 C 686 444 712 458 700 496" />
	</g>
	<path d="M 900 300 C 906 176 1254 176 1260 300" />
	<path d="M 936 300 C 942 202 1218 202 1224 300" />
	<path d="M 972 300 C 978 228 1182 228 1188 300" />
	<path d="M 892 316 L 928 316" />
	<path d="M 1232 316 L 1268 316" />
	<g transform="rotate(-8 1440 766)">
		<path d="M 1440 616 C 1534 700 1534 830 1440 916 C 1346 830 1346 700 1440 616 Z" />
		<path d="M 1440 640 C 1444 740 1444 800 1440 892" />
		<path d="M 1440 700 C 1414 692 1396 682 1384 666" />
		<path d="M 1440 760 C 1466 752 1484 742 1496 726" />
	</g>
	<g transform="rotate(5 820 800)">
		<circle cx="820" cy="800" r="188" />
		<path d="M 730 848 C 780 906 862 906 912 848" />
	</g>
	<g transform="rotate(-10 215 775)">
		<path d="M 262 560 L 132 838 L 226 838 L 150 990 L 322 726 L 226 726 L 320 560 Z" />
	</g>
	<g transform="rotate(4 320 1200)">
		<path d="${COFFEE_D}" />
	</g>
	<g transform="rotate(-7 1320 1168)">
		<path d="${SPIRAL_D}" />
	</g>
	<g transform="rotate(3 922 1426)">
		<path d="M 610 1450 C 662 1386 714 1502 766 1438 C 818 1374 870 1490 922 1426 C 974 1362 1026 1478 1078 1414 C 1130 1350 1182 1466 1234 1402" />
	</g>
	<g fill="#ffffff" stroke="none">
		<circle cx="120" cy="1420" r="7" />
		<circle cx="165" cy="1455" r="5" />
		<circle cx="96" cy="1470" r="5" />
		<circle cx="560" cy="920" r="6" />
		<circle cx="1490" cy="1080" r="6" />
		<circle cx="1050" cy="560" r="5" />
		<circle cx="620" cy="1418" r="5" />
		<circle cx="960" cy="620" r="5" />
		<circle cx="758" cy="752" r="16" />
		<circle cx="884" cy="752" r="16" />
		<circle cx="1300" cy="470" r="6" />
		<circle cx="470" cy="1000" r="6" />
	</g>
	<path d="M 520 700 L 560 700 M 540 680 L 540 720" />
	<path d="M 1040 620 L 1080 620 M 1100 640 L 1140 640" />
	<path d="M 640 640 C 660 620 690 620 710 640" />
	<path d="M 150 940 C 170 918 200 918 220 940" />
	<path d="M 1150 980 L 1176 1006 M 1180 966 L 1206 992 M 1210 952 L 1236 978" />
	<path d="M 1420 1380 L 1432 1418 L 1472 1418 L 1440 1442 L 1452 1480 L 1420 1456 L 1388 1480 L 1400 1442 L 1368 1418 L 1408 1418 Z" />
	<path d="M 1450 1520 L 1500 1520 L 1475 1478 Z" />
	<path d="M 1060 1470 C 1090 1440 1140 1450 1150 1490" />
	<path d="M 300 560 C 340 540 380 556 386 596" />
	<path d="M 900 1080 L 946 1080 M 880 1110 L 966 1110 M 900 1140 L 946 1140" />
`;

/* ----------------------------------------------------------------------------
 * Style 2 — "Hand-drawn calendar". Inspired by the reference screenshot: a
 * marker-drawn month grid. Whimsical and a bit weird — an eye, a ghost and a
 * stray question mark live in the cells alongside the numbers.
 * -------------------------------------------------------------------------- */

const CALENDAR_CELLS: (number | string)[] = [
	1, 'heart', 3, 'star', 5, 'coffee', 7,
	8, 9, 'smiley', 11, 12, 'eye', 14,
	'dots', 16, 17, 'ghost', 19, 'question', 21,
	22, 'moon', 24, 25, 'spiral', 'arrow', 28
];

/** One wobbly, hand-drawn cell (double-stroked for a sketchy feel). */
function sketchCell(x: number, y: number, w: number, h: number, seed: number): string {
	const j = (n: number) => (((seed * 37 + n * 11) % 7) - 3);
	return [
		`<path d="M ${x + j(1)} ${y + j(2)} L ${x + w + j(3)} ${y + j(4)} L ${x + w + j(5)} ${y + h + j(6)} L ${x + j(7)} ${y + h + j(8)} Z" />`,
		`<path d="M ${x + 3 + j(2)} ${y + 4 + j(1)} L ${x + w - 4 + j(4)} ${y + 6 + j(3)}" />`
	].join('');
}

function buildCalendarArt(): string {
	const parts: string[] = ['<g transform="rotate(-1.8 800 800)">'];

	// Spiral binding along the top edge.
	for (let i = 0; i < 11; i++) {
		const x = 130 + i * 134;
		parts.push(`<ellipse cx="${x}" cy="152" rx="24" ry="44" transform="rotate(-14 ${x} 152)" />`);
	}

	// A row of little icons where the weekday names would be: [art, refCx, refCy, refW].
	const headerMeta: [string, number, number, number][] = [
		[starPath(0, 0, 34), 0, 0, 76],
		[HEART_D, 380, 418, 404],
		[MOON_D, 0, 0, 150],
		[COFFEE_D, 322, 1150, 400],
		[starPath(0, 0, 34), 0, 0, 76],
		[SPIRAL_D, 1320, 1168, 320],
		[HEART_D, 380, 418, 404]
	];
	headerMeta.forEach((m, i) => {
		parts.push(place(m[0], m[1], m[2], m[3], 160 + i * 200, 258, 80));
	});

	// The grid: 7 columns × 4 rows of hand-drawn cells.
	const colW = 200;
	const rowH = 200;
	const ox = 60;
	const oy = 306;
	CALENDAR_CELLS.forEach((cell, idx) => {
		const col = idx % 7;
		const row = Math.floor(idx / 7);
		const x = ox + col * colW;
		const y = oy + row * rowH;
		parts.push(sketchCell(x, y, colW, rowH, idx + 1));
		const cx = x + colW / 2;
		const cy = y + rowH / 2 + 6;
		if (typeof cell === 'number') {
			parts.push(doodleNumber(cell, cx, cy, 96));
		} else if (cell === 'heart') {
			parts.push(place(HEART_D, 380, 418, 404, cx, cy, 118));
		} else if (cell === 'star') {
			parts.push(place(starPath(0, 0, 96), 0, 0, 192, cx, cy, 128));
		} else if (cell === 'coffee') {
			parts.push(place(COFFEE_D, 322, 1150, 400, cx, cy, 150));
		} else if (cell === 'smiley') {
			parts.push(place(SMILEY_D, 0, 0, 172, cx, cy, 132));
			parts.push(`<g fill="#ffffff" stroke="none"><circle cx="${cx - 32}" cy="${cy - 22}" r="8" /><circle cx="${cx + 32}" cy="${cy - 22}" r="8" /></g>`);
		} else if (cell === 'eye') {
			parts.push(place(EYE_D, 0, 0, 160, cx, cy, 150));
			parts.push(`<g fill="#ffffff" stroke="none"><circle cx="${cx - 2}" cy="${cy}" r="12" /></g>`);
		} else if (cell === 'ghost') {
			parts.push(place(GHOST_D, 0, 0, 116, cx, cy - 6, 130));
			parts.push(`<g fill="#ffffff" stroke="none"><circle cx="${cx - 22}" cy="${cy - 28}" r="7" /><circle cx="${cx + 22}" cy="${cy - 28}" r="7" /></g>`);
		} else if (cell === 'question') {
			parts.push(place(QUESTION_D, 0, 0, 84, cx, cy, 104));
		} else if (cell === 'moon') {
			parts.push(place(MOON_D, 0, 0, 150, cx, cy, 118));
		} else if (cell === 'spiral') {
			parts.push(place(SPIRAL_D, 1320, 1168, 300, cx, cy, 120));
		} else if (cell === 'arrow') {
			parts.push(place(ARROW_D, 0, 0, 150, cx, cy, 140));
		} else if (cell === 'dots') {
			parts.push(`<g fill="#ffffff" stroke="none"><circle cx="${cx - 28}" cy="${cy - 14}" r="13" /><circle cx="${cx + 6}" cy="${cy - 30}" r="10" /><circle cx="${cx + 22}" cy="${cy + 16}" r="13" /><circle cx="${cx - 20}" cy="${cy + 26}" r="9" /></g>`);
		}
	});

	// Notebook tabs down the right edge.
	[560, 760, 960].forEach((y) => {
		parts.push(`<path d="M 1470 ${y} L 1544 ${y + 10} L 1544 ${y + 74} L 1470 ${y + 84}" />`);
	});

	// Loose doodles filling the bottom margin.
	parts.push(place(SPIRAL_D, 1320, 1168, 300, 320, 1310, 190));
	parts.push(`<path d="M 620 1360 C 672 1296 724 1412 776 1348 C 828 1284 880 1400 932 1336 C 984 1272 1036 1388 1088 1324" />`);
	parts.push(place(ARROW_D, 0, 0, 150, 1180, 1420, 200));
	parts.push(`<path d="M 140 1430 L 156 1400 L 172 1430 M 190 1430 L 206 1400 L 222 1430 M 240 1430 L 256 1400 L 272 1430" />`);
	parts.push(doodleNumber(31, 660, 1490, 84));
	parts.push(place(QUESTION_D, 0, 0, 84, 1520, 1330, 150));
	parts.push(`<path d="M 980 1520 C 1010 1490 1060 1500 1070 1540" />`);
	parts.push(`<g fill="#ffffff" stroke="none"><circle cx="860" cy="1470" r="8" /><circle cx="1500" cy="620" r="8" /><circle cx="120" cy="640" r="7" /></g>`);
	parts.push(`<path d="M 1440 1150 L 1466 1176 M 1470 1136 L 1496 1162" />`);

	parts.push('</g>');
	return parts.join('\n');
}

/* ----------------------------------------------------------------------------
 * Style 3 — "Botanical". Potted plants, vines, ferns and scattered leaves.
 * -------------------------------------------------------------------------- */

function buildBotanicalArt(): string {
	const parts: string[] = ['<g transform="rotate(-2.4 800 800)">'];

	// Potted plant.
	parts.push(`<path d="M 236 1214 L 200 1078 L 404 1078 L 368 1214 Z" />`);
	parts.push(`<path d="M 190 1078 L 414 1078" />`);
	parts.push(`<path d="M 302 1080 C 302 1000 300 940 302 880" />`);
	parts.push(leafPath(224, 946, 62, 84, -52));
	parts.push(leafPath(380, 916, 60, 82, 46));
	parts.push(leafPath(302, 852, 56, 78, -6));
	parts.push(leafPath(206, 830, 54, 74, -62));
	parts.push(leafPath(398, 812, 54, 74, 58));
	parts.push(leafPath(302, 762, 46, 64, 4));

	// Big monstera-ish leaf with slits.
	parts.push(`<g transform="rotate(18 1252 420)">`);
	parts.push(`<path d="M 1132 250 C 1268 214 1420 300 1424 442 C 1428 584 1310 660 1178 636 C 1082 618 1054 500 1080 400 C 1098 330 1112 268 1132 250 Z" />`);
	parts.push(`<path d="M 1140 262 C 1180 380 1194 520 1180 632" />`);
	parts.push(`<path d="M 1090 360 L 1168 392 M 1082 452 L 1176 470 M 1104 546 L 1184 540" />`);
	parts.push(`</g>`);

	// A vine that meanders across the top.
	parts.push(`<path d="M 40 232 C 260 148 470 330 720 250 C 980 166 1180 344 1560 258" />`);
	for (let i = 0; i < 9; i++) {
		const t = i / 8;
		const x = 40 + t * 1520;
		const y = 232 + Math.sin(t * Math.PI * 1.6) * 44 - t * 0;
		parts.push(leafPath(x, y, 40, 58, i % 2 === 0 ? 40 : -40));
	}

	// Flower cluster.
	parts.push(`<path d="M 1120 1300 C 1128 1220 1136 1180 1150 1120" />`);
	parts.push(flowerPath(1156, 1082, 118));
	parts.push(flowerPath(1042, 1200, 76));
	parts.push(flowerPath(1254, 1216, 70));

	// Cactus.
	parts.push(`<path d="M 574 1300 C 566 1150 568 1060 600 1040 C 634 1020 646 1090 642 1300" />`);
	parts.push(`<path d="M 574 1180 C 500 1172 500 1096 536 1076" />`);
	parts.push(`<path d="M 642 1140 C 716 1132 716 1056 680 1036" />`);

	// Fern frond.
	parts.push(`<path d="M 1500 300 C 1420 470 1330 640 1258 800" />`);
	for (let i = 0; i < 10; i++) {
		const t = i / 9;
		const x = 1500 - t * 242;
		const y = 300 + t * 500;
		parts.push(leafPath(x, y, 26, 42, 55));
		parts.push(leafPath(x + 40, y + 20, 24, 38, -55));
	}

	// Hanging vine down the right edge.
	parts.push(`<path d="M 1544 900 C 1470 980 1496 1080 1512 1150 C 1528 1224 1480 1290 1452 1340" />`);
	for (let i = 0; i < 6; i++) {
		const y = 940 + i * 72;
		parts.push(leafPath(1500 - (i % 2) * 26, y, 30, 44, i % 2 === 0 ? 30 : -30));
	}

	// Grass tuft + scattered leaves + berries.
	parts.push(`<path d="M 880 1520 C 890 1470 916 1446 934 1430 M 900 1520 C 906 1478 930 1466 950 1462 M 920 1520 C 936 1482 964 1470 986 1472" />`);
	parts.push(leafPath(700, 1120, 48, 68, -34));
	parts.push(leafPath(1440, 620, 44, 62, 30));
	parts.push(leafPath(180, 640, 40, 58, -20));
	parts.push(`<path d="M 120 1420 C 180 1390 240 1420 300 1390" />`);
	parts.push(`<g fill="#ffffff" stroke="none"><circle cx="176" cy="1400" r="9" /><circle cx="232" cy="1408" r="9" /><circle cx="286" cy="1392" r="9" /><circle cx="960" cy="1408" r="8" /><circle cx="1000" cy="1440" r="8" /></g>`);

	// A couple of loose seeds/spores.
	parts.push(`<path d="M 700 1560 C 716 1536 744 1540 748 1564 C 752 1588 720 1590 708 1572 Z" />`);

	parts.push('</g>');
	return parts.join('\n');
}

/* ----------------------------------------------------------------------------
 * Style 4 — "Geometric". Abstract, calm and minimal: dotted circles, hatching,
 * nested arcs, waves and grids.
 * -------------------------------------------------------------------------- */

function buildGeometricArt(): string {
	const parts: string[] = ['<g transform="rotate(-1.5 800 800)">'];

	// Dotted bullseye rings.
	parts.push(`<circle cx="438" cy="430" r="300" stroke-dasharray="3 30" />`);
	parts.push(`<circle cx="438" cy="430" r="214" />`);
	parts.push(`<circle cx="438" cy="430" r="128" stroke-dasharray="24 20" />`);
	parts.push(`<circle cx="438" cy="430" r="52" />`);

	// Nested arcs (quarter circles) top-right.
	for (let i = 0; i < 5; i++) {
		const r = 120 + i * 62;
		parts.push(`<path d="M 1560 ${300 + i * 6} A ${r} ${r} 0 0 0 ${1560 - r} ${300 + r + i * 6}" />`);
	}

	// Hatched square.
	parts.push(`<rect x="880" y="880" width="300" height="300" />`);
	for (let i = 0; i < 6; i++) {
		parts.push(`<path d="M ${880 + i * 50} 1180 L ${1180} ${880 + i * 50}" />`);
	}

	// Long zigzag band across the bottom.
	let zig = 'M 40 1440';
	for (let i = 0; i < 16; i++) {
		zig += ` L ${40 + i * 96 + 48} ${i % 2 === 0 ? 1380 : 1440}`;
	}
	parts.push(`<path d="${zig}" />`);

	// Wavy parallel lines.
	[0, 1, 2, 3].forEach((i) => {
		const y = 760 + i * 40;
		parts.push(`<path d="M 120 ${y} C 200 ${y - 34} 280 ${y + 34} 360 ${y} C 440 ${y - 34} 520 ${y + 34} 600 ${y}" />`);
	});

	// Faint dot grid.
	const dotRnd = rng(7);
	for (let r = 0; r < 5; r++) {
		for (let c = 0; c < 6; c++) {
			if (dotRnd() > 0.62) continue;
			parts.push(`<circle cx="${640 + c * 92}" cy="${1320 + r * 60}" r="9" stroke-dasharray="2 26" />`);
		}
	}

	// Triangle + rotated square + plus grid.
	parts.push(`<path d="M 1120 500 L 1290 800 L 950 800 Z" />`);
	parts.push(`<rect x="1300" y="1180" width="200" height="200" transform="rotate(24 1400 1280)" />`);
	parts.push(`<path d="M 1460 940 L 1530 940 M 1495 905 L 1495 975" />`);
	parts.push(`<path d="M 700 1120 C 760 1060 820 1180 880 1120" stroke-dasharray="28 22" />`);

	// Scallop "cloud" row.
	let scallop = 'M 120 200';
	for (let i = 0; i < 8; i++) {
		scallop += ` A 60 60 0 0 0 ${120 + (i + 1) * 120} 200`;
	}
	parts.push(`<path d="${scallop}" />`);

	// Dashed diagonal + small half-circle pair.
	parts.push(`<path d="M 100 1120 L 420 1420" stroke-dasharray="34 24" />`);
	parts.push(`<path d="M 1000 200 A 90 90 0 0 1 1180 200" />`);
	parts.push(`<path d="M 1210 200 A 60 60 0 0 1 1330 200" />`);

	parts.push('</g>');
	return parts.join('\n');
}

/* ----------------------------------------------------------------------------
 * Style 5 — "Cosmic". Crescent moon, ringed planet, comets, constellations.
 * -------------------------------------------------------------------------- */

function buildCosmicArt(): string {
	const parts: string[] = ['<g transform="rotate(-3 800 800)">'];

	// Large crescent moon with craters.
	parts.push(`<path d="M 620 180 A 300 300 0 1 0 620 780 A 226 226 0 1 1 620 180 Z" />`);
	parts.push(`<circle cx="470" cy="330" r="34" />`);
	parts.push(`<circle cx="380" cy="510" r="24" />`);
	parts.push(`<circle cx="512" cy="600" r="18" />`);

	// Ringed planet.
	parts.push(`<circle cx="1250" cy="520" r="150" />`);
	parts.push(`<ellipse cx="1250" cy="520" rx="272" ry="74" transform="rotate(-22 1250 520)" />`);
	parts.push(`<path d="M 1150 400 C 1210 470 1210 570 1150 640" />`);

	// Comet with a tapering tail.
	parts.push(`<circle cx="520" cy="1160" r="46" />`);
	parts.push(`<path d="M 470 1180 C 360 1230 250 1290 130 1326" />`);
	parts.push(`<path d="M 486 1140 C 380 1178 276 1222 160 1246" />`);
	parts.push(`<path d="M 470 1198 C 372 1258 280 1316 180 1360" />`);

	// Constellation.
	const stars: [number, number][] = [
		[860, 1010], [1000, 1080], [1120, 1010], [1250, 1100], [1090, 1220], [900, 1220]
	];
	parts.push(`<path d="M ${stars.map((s) => s.join(' ')).join(' L ')} Z" stroke-dasharray="16 18" />`);
	stars.forEach((s) => parts.push(`<circle cx="${s[0]}" cy="${s[1]}" r="14" />`));

	// Orbit ellipse with a small moon on it.
	parts.push(`<ellipse cx="1360" cy="1320" rx="240" ry="86" transform="rotate(26 1360 1320)" />`);
	parts.push(`<circle cx="1160" cy="1470" r="30" />`);

	// A row of little moon phases.
	for (let i = 0; i < 5; i++) {
		const cx = 180 + i * 90;
		if (i === 2) parts.push(`<circle cx="${cx}" cy="1500" r="26" fill="#ffffff" stroke="none" />`);
		else parts.push(`<circle cx="${cx}" cy="1500" r="26" stroke-dasharray="${i < 2 ? '10 8' : '3 9'}" />`);
	}

	// Star field (deterministic scatter of dots and sparkles).
	const rnd = rng(23);
	for (let i = 0; i < 34; i++) {
		const x = 60 + rnd() * 1480;
		const y = 60 + rnd() * 1480;
		const r = rnd();
		if (r > 0.72) parts.push(`<path d="${sparklePath(x, y, 26 + r * 26)}" />`);
		else parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(5 + r * 9).toFixed(1)}" />`);
	}

	// A few bigger constellation stars.
	parts.push(`<path d="${starPath(700, 900, 70)}" />`);
	parts.push(`<path d="${starPath(1490, 940, 54)}" />`);
	parts.push(`<path d="${starPath(240, 900, 46)}" />`);

	// Rocket.
	parts.push(`<g transform="rotate(28 1460 660)">`);
	parts.push(`<path d="M 1460 540 C 1520 610 1520 700 1460 740 C 1400 700 1400 610 1460 540 Z" />`);
	parts.push(`<path d="M 1430 700 L 1400 780 L 1460 758 L 1520 780 L 1490 700" />`);
	parts.push(`<circle cx="1460" cy="632" r="20" />`);
	parts.push(`</g>`);

	parts.push('</g>');
	return parts.join('\n');
}

/* ----------------------------------------------------------------------------
 * "Simple shapes" style.
 * This one is special: the LIVE calendar renders it as a DOM layer of real
 * shapes (see src/react/components/ShapesBackdrop.tsx) so they can drift slowly,
 * because animations authored inside a CSS `mask-image` do not run. The static
 * artwork below is still authored so the Settings preview has something to show,
 * and it doubles as a sensible fallback.
 * -------------------------------------------------------------------------- */
function buildShapesArt(): string {
	const parts: string[] = [];
	const rand = rng(90210);
	const kinds = ['circle', 'square', 'triangle', 'diamond', 'plus', 'hexagon'];
	for (let i = 0; i < 24; i++) {
		const cx = 140 + rand() * (DOODLE_TILE - 280);
		const cy = 140 + rand() * (DOODLE_TILE - 280);
		const r = 55 + rand() * 110;
		const kind = kinds[Math.floor(rand() * kinds.length)];
		switch (kind) {
			case 'circle':
				parts.push(`<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r.toFixed(0)}" />`);
				break;
			case 'square': {
				const x = (cx - r).toFixed(0);
				const y = (cy - r).toFixed(0);
				const s = (r * 2).toFixed(0);
				parts.push(`<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="14" />`);
				break;
			}
			case 'triangle':
				parts.push(`<path d="M ${cx.toFixed(0)} ${(cy - r).toFixed(0)} L ${(cx + r * 0.92).toFixed(0)} ${(cy + r * 0.78).toFixed(0)} L ${(cx - r * 0.92).toFixed(0)} ${(cy + r * 0.78).toFixed(0)} Z" />`);
				break;
			case 'diamond':
				parts.push(`<path d="M ${cx.toFixed(0)} ${(cy - r).toFixed(0)} L ${(cx + r).toFixed(0)} ${cy.toFixed(0)} L ${cx.toFixed(0)} ${(cy + r).toFixed(0)} L ${(cx - r).toFixed(0)} ${cy.toFixed(0)} Z" />`);
				break;
			case 'plus':
				parts.push(`<path d="M ${cx.toFixed(0)} ${(cy - r).toFixed(0)} L ${cx.toFixed(0)} ${(cy + r).toFixed(0)} M ${(cx - r).toFixed(0)} ${cy.toFixed(0)} L ${(cx + r).toFixed(0)} ${cy.toFixed(0)}" />`);
				break;
			default: {
				const pts: string[] = [];
				for (let a = 0; a < 6; a++) {
					const ang = ((a * 60 - 90) * Math.PI) / 180;
					pts.push(`${(cx + Math.cos(ang) * r).toFixed(0)},${(cy + Math.sin(ang) * r).toFixed(0)}`);
				}
				parts.push(`<polygon points="${pts.join(' ')}" />`);
				break;
			}
		}
	}
	return parts.join('');
}

/* ----------------------------------------------------------------------------
 * Style registry + URL construction.
 * -------------------------------------------------------------------------- */

const ART_BY_STYLE: Record<string, string> = {
	sketch: SKETCH_ART,
	calendar: buildCalendarArt(),
	botanical: buildBotanicalArt(),
	geometric: buildGeometricArt(),
	cosmic: buildCosmicArt(),
	shapes: buildShapesArt()
};

/** The artwork wrapped in a self-contained SVG, ready to be percent-encoded. */
function buildDoodleSvg(art: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${DOODLE_TILE}" height="${DOODLE_TILE}" viewBox="0 0 ${DOODLE_TILE} ${DOODLE_TILE}" fill="none" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">${art}</svg>`;
}

const URL_CACHE: Record<string, string> = {};

/**
 * The chosen doodle style as a CSS `url(...)` value for a `mask-image`. Encoded
 * (not base64) so the SVG stays human-readable in devtools while still being a
 * valid data URI. Results are cached because the App calls this on every render.
 */
export function getDoodlePatternUrl(style?: string): string {
	const key = style && ART_BY_STYLE[style] ? style : DEFAULT_DOODLE_STYLE;
	if (!URL_CACHE[key]) {
		URL_CACHE[key] = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildDoodleSvg(ART_BY_STYLE[key]))}")`;
	}
	return URL_CACHE[key];
}

/** True when the value is one of the known doodle styles. */
export function isDoodleStyle(value: unknown): boolean {
	return typeof value === 'string' && Boolean(ART_BY_STYLE[value]);
}

/** Clamp a raw doodle-opacity setting into a safe percentage. */
export function clampDoodleOpacity(value: unknown): number {
	const num = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_DOODLE_OPACITY;
	return Math.min(100, Math.max(0, num));
}

/**
 * True when a doodle style is rendered as an ANIMATED DOM layer rather than as a
 * static mask (see ShapesBackdrop.tsx). Used to add the `sleek-has-shapes` class
 * that swaps the static mask for the moving shapes.
 */
export function isAnimatedDoodleStyle(style?: string): boolean {
	return style === 'shapes';
}

/* ----------------------------------------------------------------------------
 * "Simple shapes" tuning knobs.
 *
 * These only affect the animated `shapes` style (the DOM layer in
 * ShapesBackdrop.tsx) — the mask-based styles are a single fixed tile, so there
 * is nothing to count, resize or spin. Values are all plain numbers so they
 * round-trip through Obsidian's data.json without coercion surprises.
 * -------------------------------------------------------------------------- */

/** How many shapes are scattered across the layer. */
export const DEFAULT_DOODLE_SHAPE_COUNT = 40;
export const MIN_DOODLE_SHAPE_COUNT = 4;
export const MAX_DOODLE_SHAPE_COUNT = 96;

/** Size of each shape, as a percentage of the neutral baseline (100 = default). */
export const DEFAULT_DOODLE_SHAPE_SIZE = 100;
export const MIN_DOODLE_SHAPE_SIZE = 40;
export const MAX_DOODLE_SHAPE_SIZE = 220;

/** Global spin applied to the whole field, in degrees. */
export const DEFAULT_DOODLE_SHAPE_ROTATION = 0;
export const MIN_DOODLE_SHAPE_ROTATION = -180;
export const MAX_DOODLE_SHAPE_ROTATION = 180;

/** Outline weight of each shape, in SVG user units (≈ px thanks to non-scaling-stroke). */
export const DEFAULT_DOODLE_SHAPE_STROKE = 4;
export const MIN_DOODLE_SHAPE_STROKE = 1;
export const MAX_DOODLE_SHAPE_STROKE = 10;

/** How far the shapes sit from the centre of the field, as a multiplier.
 *  1 = the neutral scatter; above 1 pushes them apart, below 1 draws them together. */
export const DEFAULT_DOODLE_SHAPE_SPREAD = 1;
export const MIN_DOODLE_SHAPE_SPREAD = 0.5;
export const MAX_DOODLE_SHAPE_SPREAD = 1.6;

/** Clamp any untrusted value into [min, max], falling back when it isn't a number. */
function clampDoodleNumber(value: unknown, fallback: number, min: number, max: number): number {
	const num = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
	return Math.min(max, Math.max(min, num));
}

export function clampDoodleShapeCount(value: unknown): number {
	return Math.round(clampDoodleNumber(value, DEFAULT_DOODLE_SHAPE_COUNT, MIN_DOODLE_SHAPE_COUNT, MAX_DOODLE_SHAPE_COUNT));
}

export function clampDoodleShapeSize(value: unknown): number {
	return Math.round(clampDoodleNumber(value, DEFAULT_DOODLE_SHAPE_SIZE, MIN_DOODLE_SHAPE_SIZE, MAX_DOODLE_SHAPE_SIZE));
}

export function clampDoodleShapeRotation(value: unknown): number {
	return Math.round(clampDoodleNumber(value, DEFAULT_DOODLE_SHAPE_ROTATION, MIN_DOODLE_SHAPE_ROTATION, MAX_DOODLE_SHAPE_ROTATION));
}

export function clampDoodleShapeStroke(value: unknown): number {
	return clampDoodleNumber(value, DEFAULT_DOODLE_SHAPE_STROKE, MIN_DOODLE_SHAPE_STROKE, MAX_DOODLE_SHAPE_STROKE);
}

export function clampDoodleShapeSpread(value: unknown): number {
	return clampDoodleNumber(value, DEFAULT_DOODLE_SHAPE_SPREAD, MIN_DOODLE_SHAPE_SPREAD, MAX_DOODLE_SHAPE_SPREAD);
}
