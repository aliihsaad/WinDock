#!/usr/bin/env python3
"""Renders WinDock's bundled backgrounds into public/wallpapers.

Each scene is a small procedural render of something physical, so the art stays
free of licensing questions and can be regenerated at any size. The output is
committed, and neither the host nor the phone ever runs this file.

    python scripts/wallpapers/render.py                 # every scene
    python scripts/wallpapers/render.py silk --scale .4 # quick look at one scene

Needs numpy and Pillow with WebP support.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image

WIDTH, HEIGHT = 2400, 1120  # Wider than any phone, so `cover` only ever trims.
THUMB_WIDTH = 480
OUT = Path(__file__).resolve().parents[2] / "public" / "wallpapers"


# Colour helpers. Everything is lit in linear light and encoded once at the end.
def linear(hex_colour):
    channels = np.array([int(hex_colour[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32) / 255
    return np.where(channels <= 0.04045, channels / 12.92, ((channels + 0.055) / 1.055) ** 2.4)


def encode(rgb):
    rgb = np.clip(rgb, 0, 1)
    return np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - 0.055)


def smoothstep(low, high, value):
    t = np.clip((value - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    t = np.asarray(t)
    return a + (b - a) * (t[..., None] if t.ndim else t)


def ramp(t, stops):
    """Blends across [(position, colour), ...] for an array of positions."""
    positions = [stop[0] for stop in stops]
    colours = np.stack([linear(stop[1]) for stop in stops])
    return np.stack([np.interp(t, positions, colours[:, channel]) for channel in range(3)], axis=-1)


# Noise. Gradient noise keeps its lattice hidden far better than value noise.
_tables = {}


def _table(seed):
    if seed not in _tables:
        rng = np.random.default_rng(seed)
        angles = rng.uniform(0, 2 * np.pi, 256)
        _tables[seed] = (rng.permutation(256), np.cos(angles), np.sin(angles))
    return _tables[seed]


def noise(x, y, seed=0):
    x, y = np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64)
    perm, gradient_x, gradient_y = _table(seed)
    cell_x, cell_y = np.floor(x), np.floor(y)
    fx, fy = x - cell_x, y - cell_y
    ix, iy = cell_x.astype(np.int64), cell_y.astype(np.int64)

    def corner(ox, oy):
        index = perm[(perm[(ix + ox) & 255] + iy + oy) & 255]
        return gradient_x[index] * (fx - ox) + gradient_y[index] * (fy - oy)

    fade_x = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    fade_y = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    top = corner(0, 0) + (corner(1, 0) - corner(0, 0)) * fade_x
    bottom = corner(0, 1) + (corner(1, 1) - corner(0, 1)) * fade_x
    return (top + (bottom - top) * fade_y) * 1.5


def fbm(x, y, octaves=4, gain=0.5, lacunarity=2.02, seed=0):
    total, amplitude, norm = 0.0, 1.0, 0.0
    for octave in range(octaves):
        total = total + amplitude * noise(x + octave * 17.3, y - octave * 9.1, seed)
        norm += amplitude
        amplitude *= gain
        x, y = x * lacunarity, y * lacunarity
    return total / norm


def blur(image, sigma_x, sigma_y=None):
    """Gaussian blur through the FFT, so a wide bloom costs the same as a tight one."""
    sigma_y = sigma_x if sigma_y is None else sigma_y
    single = image.ndim == 2
    if single:
        image = image[..., None]
    pad_y, pad_x = int(3 * sigma_y) + 1, int(3 * sigma_x) + 1
    padded = np.pad(image, ((pad_y, pad_y), (pad_x, pad_x), (0, 0)), mode="reflect")
    frequency_y = np.fft.fftfreq(padded.shape[0])[:, None]
    frequency_x = np.fft.rfftfreq(padded.shape[1])[None, :]
    response = np.exp(-2 * np.pi ** 2 * ((frequency_x * sigma_x) ** 2 + (frequency_y * sigma_y) ** 2))
    result = np.fft.irfft2(np.fft.rfft2(padded, axes=(0, 1)) * response[..., None], s=padded.shape[:2], axes=(0, 1))
    result = result[pad_y:pad_y + image.shape[0], pad_x:pad_x + image.shape[1]]
    return result[..., 0] if single else result


class Canvas:
    """Coordinates for one render: u runs 0..aspect, v runs 0..1 from the top."""

    def __init__(self, scale):
        self.w, self.h = round(WIDTH * scale), round(HEIGHT * scale)
        self.aspect = self.w / self.h
        v, u = np.mgrid[0:self.h, 0:self.w].astype(np.float64)
        self.u, self.v = (u + 0.5) / self.h, (v + 0.5) / self.h


def stars(canvas, seed, count=2600, keep=None):
    """A sparse field with a realistic spread: many faint stars, a few bright ones."""
    rng = np.random.default_rng(seed)
    size = canvas.h / HEIGHT
    field = np.zeros((canvas.h, canvas.w))
    x, y = rng.integers(0, canvas.w, count), rng.integers(0, canvas.h, count)
    np.add.at(field, (y, x), rng.pareto(3, count) * .05 + .012)
    points = blur(field, .8 * size + .2) * (2.2 / (size + .35))
    bright = np.where(field > .22, field, 0)
    points = points + blur(bright, 3.2 * size + .5) * 7 * size
    return points if keep is None else points * keep


def aurora(canvas):
    """Curtains of light hanging from a sinuous lower edge, as seen from the ground."""
    u, v = canvas.u, canvas.v
    image = ramp(v, [(0, "#03060d"), (.6, "#06121b"), (1, "#0a2228")])
    image = image + stars(canvas, 11, keep=smoothstep(.92, .3, v))[..., None] * linear("#cfe0f2")

    curtains = [  # base, swing, phase, reach, strength
        (.70, .19, .5, .30, 1.0),
        (.56, .15, 2.5, .25, .5),
        (.40, .10, 4.3, .20, .34),
    ]
    light = np.zeros_like(image)
    for index, (base, swing, phase, reach, strength) in enumerate(curtains):
        curve = base + swing * np.sin(u * 1.7 + phase) + .34 * swing * np.sin(u * 4.1 + phase * 1.7)
        curve = curve + .035 * noise(u * 2.3, phase, 12)
        slope = np.abs(np.gradient(curve, axis=1)) * canvas.h
        rise = curve - v
        # Rays lean with altitude, which is what stops them reading as vertical bars.
        lean = u + rise * (.14 + .22 * np.sin(u * 2.1 + phase))
        rays = (.5 + .5 * fbm(lean * 34, phase + index, 4, .62, seed=13)) ** 2.3 * 2.3 + .26
        gather = .58 + .95 * smoothstep(.1, .9, slope)
        fade = smoothstep(-.1, .5, u) * smoothstep(canvas.aspect + .1, canvas.aspect - .5, u)
        height = np.maximum(rise, 0)
        body = np.exp(-height / reach) * smoothstep(-.016, .012, rise)
        edge = np.exp(-(rise / .026) ** 2) * smoothstep(-.03, .0, rise)
        crown = np.exp(-((height - reach * 1.3) / (reach * .75)) ** 2) * smoothstep(0, .05, rise)
        energy = (strength * gather * fade * rays)[..., None]
        light = light + energy * (body[..., None] * linear("#22d98c") * .62
                                  + edge[..., None] * linear("#c4ffd9") * .34
                                  + crown[..., None] * linear("#6a3fd4") * .24)
    light = blur(light, 1.6 * canvas.h / HEIGHT + .3, .8)
    image = image + light + blur(light, 44 * canvas.h / HEIGHT + 1) * .55

    # A low black ridge gives the sky a ground to stand on.
    ridge = .895 + .046 * fbm(u * 1.5, 3.3, 5, seed=9) + .01 * fbm(u * 9, 1.2, 3, seed=10)
    land = smoothstep(ridge - .0016, ridge + .0016, v)
    return image * (1 - land[..., None]) + linear("#03090c") * land[..., None]


def dusk(canvas):
    """Ridges receding into haze, with fog pooling in each valley."""
    u, v = canvas.u, canvas.v
    sun = np.hypot((u - canvas.aspect * .66) * .62, (v - .63) * 1.25)
    sky = ramp(v, [(0, "#0d0b24"), (.26, "#231547"), (.47, "#5a2a6b"), (.6, "#b0506f"), (.68, "#e78c6c")])
    image = sky + (np.exp(-sun * 3.2) * .55)[..., None] * linear("#ffb178") + (np.exp(-(sun / .055) ** 2) * 1.2)[..., None] * linear("#ffe2b8")
    image = image + stars(canvas, 21, 900, smoothstep(.34, .05, v))[..., None] * linear("#d9d6f2")
    layers = 7
    for index in range(layers):
        depth = index / (layers - 1)
        base = .545 + depth ** 1.25 * .385
        swing = .03 + depth * .075
        offset = index * 3.7
        crest = base - swing * (fbm(u * (1.05 + depth * .35) + offset, offset, 5, .47, seed=23) * 1.7
                                + .32 * np.abs(noise(u * 4.1 + offset, offset * .5, 24)))
        haze = ramp(np.full(1, depth), [(0, "#c36a78"), (.38, "#7a3a70"), (.72, "#33204f"), (1, "#0c0a1b")])[0]
        deep = ramp(np.full(1, depth), [(0, "#a14f71"), (.38, "#4f2a60"), (.72, "#1f163b"), (1, "#080713")])[0]
        fog = smoothstep(0, .2 + depth * .08, v - crest)
        body = mix(deep, haze, fog * (.95 - depth * .65))
        mask = smoothstep(-.0012, .0012, v - crest)[..., None]
        image = image * (1 - mask) + body * mask
    return image


def ember(canvas):
    """Wind-cut dunes under a low sun, painted front to back so crests hide what lies behind."""
    columns = np.arange(canvas.w)
    screen = (columns + .5) / canvas.w - .5
    horizon = .25
    camera = .78
    image = ramp(canvas.v, [(0, "#0b0508"), (.11, "#1c0a0d"), (.19, "#4e2115"), (.24, "#a65a2b"), (.262, "#dc9450")])
    glow = np.exp(-np.hypot((canvas.u / canvas.aspect - .24) * 1.4, (canvas.v - horizon) * 3) * 6.4)
    image = image + glow[..., None] * linear("#ffb36f") * .5
    frontier = np.full(canvas.w, canvas.h, dtype=np.int64)  # Lowest row still unpainted, per column.

    near, far, slices = .1, 26.0, int(3000 * canvas.h / HEIGHT) + 420
    distances = near * (far / near) ** (np.arange(slices) / (slices - 1))
    sun = np.array([-.9, .2, .34])
    sun = sun / np.linalg.norm(sun)

    def height(x, z):
        warp_x = x + .55 * fbm(x * .55, z * .55, 3, seed=31)
        warp_z = z + .55 * fbm(x * .55 + 7, z * .55, 3, seed=32)
        phase = (warp_x * .95 + warp_z * .55) * 1.08 + .55 * fbm(warp_x * .3, warp_z * .3, 2, seed=33)
        cell = phase - np.floor(phase)
        crest = .8
        shape = np.where(cell < crest, smoothstep(0, crest, cell) ** 1.35, 1 - smoothstep(crest, 1, cell))
        swell = .55 + .5 * noise(x * .24, z * .24, 34)
        return shape * swell * .34 + .2 * fbm(x * .2, z * .2, 3, seed=35)

    lit = linear("#9c4a26")
    bright = linear("#dc8a52")
    shade = linear("#1b090e")
    haze = linear("#7c3820")
    step = .01
    for distance in distances:
        x = screen * distance * 2.1
        h = height(x, distance)
        dx = (height(x + step, distance) - h) / step
        dz = (height(x, distance + step) - h) / step
        normal = np.stack([-dx, np.ones_like(dx), -dz], -1)
        normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
        diffuse = np.clip(normal @ sun, 0, 1)
        ripple = np.sin((x * 2.2 + distance * 3.1 + .35 * noise(x * 1.4, distance * 1.4, 36)) * 150) * .5 + .5
        ripple = 1 + (ripple - .5) * .12 * smoothstep(2.6, .5, distance)
        light = smoothstep(.1, .78, diffuse) * ripple
        colour = mix(mix(shade, lit, light), bright, smoothstep(.72, 1.05, light) * .8)
        atmosphere = 1 - np.exp(-distance / 11)
        colour = colour * (1 - atmosphere) + haze * atmosphere * (.55 + .45 * light[..., None])
        projected = horizon + (camera - h) / distance * .23
        top = np.clip((projected * canvas.h).astype(np.int64), 0, canvas.h)
        for column in np.nonzero(top < frontier)[0]:
            image[top[column]:frontier[column], column] = colour[column]
        frontier = np.minimum(frontier, top)
    return blur(image, .6 * canvas.h / HEIGHT + .25)


def midnight(canvas):
    """The edge of a dark planet, an hour before sunrise."""
    u, v = canvas.u, canvas.v
    radius = 3.1
    centre_x, centre_y = canvas.aspect * .38, radius + .46
    dx, dy = u - centre_x, v - centre_y
    altitude = np.hypot(dx, dy) - radius
    angle = np.arctan2(dx, -dy)
    sunrise = np.exp(-((angle - .34) / .3) ** 2)
    day = np.exp(-((angle - .34) / .62) ** 2)
    above = altitude > 0

    image = stars(canvas, 41, 3300)[..., None] * linear("#d7e4ff") * above[..., None]
    image = image + ramp(v, [(0, "#02040a"), (1, "#050a18")])
    thin = np.exp(-np.maximum(altitude, 0) / .0052)
    air = np.exp(-np.maximum(altitude, 0) / .03)
    high = np.exp(-np.maximum(altitude, 0) / .13)
    fall = smoothstep(.16, .5, day + .02)
    image = image + (air * (.18 + 1.1 * day))[..., None] * linear("#2a7dff")
    image = image + (high * (.05 + .3 * day))[..., None] * linear("#163fa8")
    image = image + (thin * (.4 + 1.6 * fall))[..., None] * linear("#8fd8ff")
    image = image + (np.exp(-np.maximum(altitude, 0) / .007) * sunrise)[..., None] * linear("#ffd9a8") * 3.2
    planet = smoothstep(.0012, -.0012, altitude)
    night = ramp(np.clip(-altitude / .55, 0, 1), [(0, "#0c1a33"), (.14, "#060c1b"), (1, "#02040a")])
    limb_glow = (np.exp(altitude / .024) * (.05 + .6 * sunrise))[..., None] * linear("#3a7be0")
    grain = 1 + .12 * fbm(u * 7, v * 22, 5, seed=42)[..., None]
    surface = night * grain + limb_glow
    image = image * (1 - planet[..., None]) + surface * planet[..., None]
    # The point of light where the sun is about to clear the edge.
    flare_x, flare_y = centre_x + np.sin(.34) * radius, centre_y - np.cos(.34) * radius
    flare = np.hypot(u - flare_x, (v - flare_y) * 1.2)
    halo = np.exp(-flare / .09) * .16 * (1 - planet * .86)
    return image + (np.exp(-flare / .012) * 2.2 + halo)[..., None] * linear("#ffe8c9")


def _surface_normal(height, canvas, depth):
    dy, dx = np.gradient(height, 1 / canvas.h)
    normal = np.stack([-dx * depth, -dy * depth, np.ones_like(dx)], -1)
    return normal / np.linalg.norm(normal, axis=-1, keepdims=True)


def obsidian(canvas):
    """Polished black glass with a slow swell, lit by a long studio strip."""
    u, v = canvas.u, canvas.v
    x, y = u * .46, v * .46
    warp_x, warp_y = fbm(x + 1.7, y + 9.2, 2, seed=51), fbm(x + 8.3, y + 2.8, 2, seed=52)
    height = fbm(x + 1.05 * warp_x, y + 1.05 * warp_y, 2, .3, seed=55)
    normal = _surface_normal(height, canvas, .26)
    reflect = normal * (2 * normal[..., 2:3]) - np.array([0, 0, 1.0])

    def strip(direction, width, softness=1.0):
        along = reflect[..., 0] * direction[0] + reflect[..., 1] * direction[1]
        return np.exp(-(np.abs(along - direction[2]) / width) ** (1.7 * softness))

    key = strip((.42, .9, -.1), .022)
    glow = strip((.42, .9, -.1), .1)
    fill = strip((-.8, .6, .13), .05)
    rim = strip((.2, -.98, -.2), .016)
    image = ramp(v, [(0, "#0a0b0f"), (1, "#050609")])
    image = image + glow[..., None] * linear("#3a4150") * .42
    image = image + key[..., None] * linear("#dfe5ef") * .5
    image = image + fill[..., None] * linear("#6f7c94") * .22
    image = image + rim[..., None] * linear("#a8bbe0") * .2
    return image


def silk(canvas):
    """Heavy satin falling in long folds, with sheen running along each one."""
    u, v = canvas.u, canvas.v
    tilt = np.deg2rad(24)
    along = u * np.cos(tilt) + v * np.sin(tilt)
    across = -u * np.sin(tilt) + v * np.cos(tilt)
    bend = .42 * fbm(along * .8, across * .7, 3, .42, seed=61)
    drift = across + bend
    folds = (.62 * np.sin(drift * 8.3 + 1.1) + .28 * np.sin(drift * 17.5 + 2.2 + 2.2 * bend)
             + .1 * np.sin(drift * 39 + .7 + 3 * bend))
    height = folds * .05 + .02 * fbm(along * 1.3, across * 2.6, 3, seed=63)
    normal = _surface_normal(height, canvas, 1.0)
    light = np.array([.36, -.58, .73])
    light = light / np.linalg.norm(light)
    half = light + np.array([0, 0, 1.0])
    half = half / np.linalg.norm(half)
    diffuse = np.clip(normal @ light, 0, 1)
    facing = np.clip(normal @ half, 0, 1)
    # Satin shines broadly with a tight core, so one highlight needs both lobes.
    sheen = facing ** 26
    core = facing ** 170
    base = mix(linear("#0b0205"), linear("#4d0f26"), smoothstep(.42, 1, diffuse) ** 1.25)
    image = base + sheen[..., None] * linear("#9c2a44") * .36 + core[..., None] * linear("#ffc4ba") * .3
    return image * (.62 + .5 * smoothstep(1.3, -.1, v + .1 * u))[..., None]


def lagoon(canvas):
    """True caustics: sunlight bent by a rippling surface and landing on a pool floor."""
    scale, margin = 3, .14
    rng = np.random.default_rng(71)
    waves = 15
    angles = rng.uniform(0, 2 * np.pi, waves)
    lengths = rng.uniform(.085, .15, waves)
    phases = rng.uniform(0, 2 * np.pi, waves)
    kx, ky = 2 * np.pi / lengths * np.cos(angles), 2 * np.pi / lengths * np.sin(angles)
    h, w = int(canvas.h * (1 + 2 * margin)) * scale, int((canvas.aspect + 2 * margin) * canvas.h) * scale
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    x, y = x / canvas.h / scale - margin, y / canvas.h / scale - margin
    dx, dy = np.zeros_like(x), np.zeros_like(y)
    for index in range(waves):
        wave = np.cos(kx[index] * x + ky[index] * y + phases[index]).astype(np.float32)
        dx += kx[index] * wave
        dy += ky[index] * wave
    normal = 1 / np.sqrt(waves)
    light = np.zeros((canvas.h, canvas.w, 3))
    for channel, reach in enumerate((.00075, .00072, .00069)):  # Blue bends a little less here.
        px = ((x - dx * normal * reach) * canvas.h).astype(np.int32)
        py = ((y - dy * normal * reach) * canvas.h).astype(np.int32)
        inside = (px >= 0) & (px < canvas.w) & (py >= 0) & (py < canvas.h)
        density = np.bincount(py[inside] * canvas.w + px[inside], minlength=canvas.w * canvas.h)
        light[..., channel] = density.reshape(canvas.h, canvas.w) / (scale * scale)
    light = blur(light, 1.1 * canvas.h / HEIGHT + .45)
    u, v = canvas.u, canvas.v
    sun = np.exp(-np.hypot((u - canvas.aspect * .3) * .46, (v + .05) * .82) * 1.75)[..., None]
    floor = ramp(v, [(0, "#0b5564"), (.5, "#053342"), (1, "#021824")])
    filaments = np.maximum(light - 1.0, 0)
    filaments = filaments ** 1.35 / (1 + .3 * filaments ** 1.35)  # Soft-limits the brightest knots.
    image = floor * (.66 + .26 * light.mean(-1, keepdims=True)) * (.3 + .95 * sun)
    tint = np.array([linear("#7ff5ea")[0], linear("#c8ffe6")[1], linear("#a6e6ff")[2]])
    return image + filaments * tint * (.017 + .2 * sun) + blur(filaments * tint, 14 * canvas.h / HEIGHT + 1) * (.016 + .065 * sun)


def prism(canvas):
    """A beam of light split by reeded glass, each flute showing its own slice."""
    u, v = canvas.u, canvas.v
    spectrum = [(-1.2, "#000000"), (-.92, "#b8345c"), (-.5, "#c9713c"), (-.16, "#c7b569"), (.14, "#46b598"),
                (.5, "#2f89c7"), (.86, "#4a43c9"), (1.14, "#8a3ec4"), (1.44, "#000000")]

    def beam(x, y):
        position = (x * .5 + y * .86 - 1.1) / .155 + .34 * np.sin(x * 1.7 + 1)
        strength = np.exp(-((x - canvas.aspect * .63) / .72) ** 2)
        return ramp(np.clip(position, -1.2, 1.44), spectrum) * strength[..., None]

    flutes = 46
    cell = u * flutes / canvas.aspect
    t = cell - np.floor(cell) - .5
    lens = np.sin(t * np.pi)  # Runs -1..1 across a flute.
    bent = u + lens * .082
    image = beam(bent, v)
    # Each channel lands slightly apart, so the flute edges fringe the way real glass does.
    image[..., 0] = beam(bent + lens * .01, v)[..., 0]
    image[..., 2] = beam(bent - lens * .01, v)[..., 2]
    shoulder = np.abs(lens) ** 5
    image = image * (.48 + .46 * (1 - np.abs(lens)))[..., None] * (1 - shoulder * .8)[..., None]
    backdrop = ramp(v, [(0, "#07070d"), (1, "#0a0912")])
    sheen = np.exp(-((t + .3) / .05) ** 2) * .018 + np.exp(-((t - .46) / .03) ** 2) * .007
    return image + backdrop * (1 - shoulder * .5)[..., None] + sheen[..., None] * linear("#c9cfe6")


SCENES = {
    "aurora": aurora,
    "dusk": dusk,
    "ember": ember,
    "midnight": midnight,
    "obsidian": obsidian,
    "silk": silk,
    "lagoon": lagoon,
    "prism": prism,
}


def finish(image, seed):
    """Dithers before quantising, which is what keeps dark gradients from banding."""
    rng = np.random.default_rng(seed)
    encoded = encode(image.astype(np.float64))
    dither = (rng.random(encoded.shape) - rng.random(encoded.shape)) * (1.2 / 255)
    return Image.fromarray((np.clip(encoded + dither, 0, 1) * 255 + .5).astype(np.uint8))


def grain(target, size=128):
    """A tile of faint specks for the phone to lay over the art. See .wallpaper::after."""
    alpha = np.random.default_rng(3).integers(0, 4, (size, size), dtype=np.uint8)
    Image.merge("LA", (Image.new("L", (size, size), 255), Image.fromarray(alpha))).save(target, optimize=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenes", nargs="*", choices=[*SCENES, []], help="scenes to render, default all")
    parser.add_argument("--scale", type=float, default=1.0, help="render smaller for a quick look")
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--quality", type=int, default=86)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for name in args.scenes or SCENES:
        rendered = finish(SCENES[name](Canvas(args.scale)), len(name))
        target = args.out / f"{name}.webp"
        rendered.save(target, "WEBP", quality=args.quality, method=6)
        thumb = rendered.resize((THUMB_WIDTH, round(THUMB_WIDTH * rendered.height / rendered.width)), Image.LANCZOS)
        thumb.save(args.out / f"{name}-thumb.webp", "WEBP", quality=78, method=6)
        print(f"{name}: {rendered.width}x{rendered.height}, {target.stat().st_size // 1024} KB, thumb {(args.out / f'{name}-thumb.webp').stat().st_size // 1024} KB")
    grain(args.out / "grain.png")


if __name__ == "__main__":
    main()
