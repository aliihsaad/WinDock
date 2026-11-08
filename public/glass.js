/**
 * Refraction for WinDock's floating glass.
 *
 * style.css draws the rim and reflection in every browser. This module adds the
 * part CSS cannot: bending what sits behind the glass at its curved edge. It fits
 * an SVG displacement filter to each surface and hands it to backdrop-filter.
 *
 * Only surfaces that float over the dock get a lens. Dock tiles sit on smooth
 * wallpaper with nothing to bend, and they animate while arranging.
 */

const SURFACES = ".glass-drawer, .sheet, .options, .confirm, .glass-menu";
const SVG = "http://www.w3.org/2000/svg";

/**
 * Only Chromium draws backdrop-filter: url(). WebKit is reported to accept the
 * rule and paint nothing, so @supports cannot decide this. Other engines keep blur.
 */
export const canBend = (userAgent) => /Chrome\/\d/.test(userAgent);

/** The curved band stays inside the corner radius, so its direction never creases. */
export const bezelFor = (radius) => Math.max(10, Math.min(radius, 34));

const smoothstep = (from, to, value) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/**
 * Computes the two images one rounded rectangle needs.
 *   map:  red and green hold how far each pixel samples sideways. 128 means stay.
 *   mask: alpha is full at the edge and gone past the bezel, where frost takes over.
 * Sampling points inward, so the rim shows content from further inside the panel,
 * as the curved edge of a real lens does. It also means no pixel needs anything
 * from outside the element, which backdrop-filter could not provide.
 */
export function drawLens(width, height, radius, bezel) {
  const map = new Uint8ClampedArray(width * height * 4);
  const mask = new Uint8ClampedArray(width * height * 4);
  const innerX = width / 2 - radius, innerY = height / 2 - radius;
  for (let y = 0, index = 0; y < height; y++) {
    for (let x = 0; x < width; x++, index += 4) {
      const px = x + .5 - width / 2, py = y + .5 - height / 2;
      const qx = Math.abs(px) - innerX, qy = Math.abs(py) - innerY;
      const cornerX = Math.max(qx, 0), cornerY = Math.max(qy, 0);
      const corner = Math.hypot(cornerX, cornerY);
      // Distance inward from the rounded edge, and the outward direction there.
      const depth = radius - corner - Math.min(Math.max(qx, qy), 0);
      let normalX = 0, normalY = 0;
      if (corner > 0) { normalX = cornerX / corner * Math.sign(px); normalY = cornerY / corner * Math.sign(py); }
      else if (qx > qy) normalX = Math.sign(px);
      else normalY = Math.sign(py);
      const t = Math.min(1, Math.max(0, depth / bezel));
      const strength = depth < 0 ? 0 : (1 - t) ** 2.4;
      map[index] = 128 - 127 * normalX * strength;
      map[index + 1] = 128 - 127 * normalY * strength;
      map[index + 2] = 128;
      map[index + 3] = 255;
      mask[index] = mask[index + 1] = mask[index + 2] = 255;
      mask[index + 3] = 255 * (1 - smoothstep(.3, 1, t));
    }
  }
  return { map, mask };
}

function dataUrl(pixels, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d").putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas.toDataURL();
}

function svgNode(name, attributes = {}, ...children) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

/** Frost across the panel, with a sharper, bent image laid over it along the rim. */
function lensFilter(id, width, height, radius, blur) {
  const bezel = bezelFor(radius);
  const { map, mask } = drawLens(width, height, radius, bezel);
  const image = (pixels, result) => svgNode("feImage", {
    href: dataUrl(pixels, width, height), x: 0, y: 0, width, height, preserveAspectRatio: "none", result,
  });
  // Filters default to linearRGB, which would turn a neutral 128 into a shift.
  return svgNode("filter", { id, filterUnits: "userSpaceOnUse", primitiveUnits: "userSpaceOnUse", x: 0, y: 0, width, height, "color-interpolation-filters": "sRGB" },
    image(map, "map"), image(mask, "mask"),
    svgNode("feGaussianBlur", { in: "SourceGraphic", stdDeviation: blur, result: "frost" }),
    svgNode("feColorMatrix", { in: "frost", type: "saturate", values: 1.3, result: "tinted" }),
    svgNode("feGaussianBlur", { in: "SourceGraphic", stdDeviation: .7, result: "clear" }),
    svgNode("feDisplacementMap", { in: "clear", in2: "map", scale: bezel * 1.7, xChannelSelector: "R", yChannelSelector: "G", result: "bent" }),
    svgNode("feComposite", { in: "bent", in2: "mask", operator: "in", result: "rim" }),
    svgNode("feMerge", {}, svgNode("feMergeNode", { in: "tinted" }), svgNode("feMergeNode", { in: "rim" })));
}

export function startGlass() {
  const root = document.documentElement;

  // The reflection leans toward a finger. Set per surface, because a root value
  // would restyle the whole page on every move, including during touchpad use.
  document.addEventListener("pointermove", (event) => {
    const surface = event.target.closest?.(SURFACES);
    if (!surface || root.classList.contains("perf")) return;
    const box = surface.getBoundingClientRect();
    surface.style.setProperty("--light-x", `${((event.clientX - box.left) / box.width * 100).toFixed(1)}%`);
  }, { passive: true });

  if (!canBend(navigator.userAgent)) return;
  root.setAttribute("data-bend", "");
  const defs = svgNode("defs");
  const svg = svgNode("svg", { width: 0, height: 0, "aria-hidden": "true" }, defs);
  svg.style.position = "absolute";
  document.body.append(svg);
  const surfaces = [...document.querySelectorAll(SURFACES)];
  // Each surface owns one filter, so resizing a window cannot pile images up.
  const lenses = new Map();
  let nextId = 0;

  function fit(element) {
    const width = element.offsetWidth, height = element.offsetHeight;
    if (!width || !height || root.classList.contains("perf")) return;
    const style = getComputedStyle(element);
    const radius = Math.min(parseFloat(style.borderTopLeftRadius), width / 2, height / 2);
    const blur = parseFloat(style.getPropertyValue("--glass-lens-blur"));
    const key = `${width}x${height}r${radius}b${blur}`;
    if (lenses.get(element)?.key === key) return;
    const filter = lensFilter(`glass-lens-${nextId++}`, width, height, radius, blur);
    defs.append(filter);
    element.style.setProperty("--lens", `url(#${filter.id})`);
    lenses.get(element)?.filter.remove();
    lenses.set(element, { key, filter });
  }

  const resized = new ResizeObserver((entries) => entries.forEach((entry) => fit(entry.target)));
  surfaces.forEach((surface) => resized.observe(surface));
  // Each glass style has its own frost, and Performance mode can be turned back off.
  new MutationObserver(() => surfaces.forEach(fit)).observe(root, { attributes: true, attributeFilter: ["data-theme", "class"] });
}
