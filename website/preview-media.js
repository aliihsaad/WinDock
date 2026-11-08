// Fictional, silent tracks. Artwork is drawn locally; no player or device is contacted.
const tracks = [
  { title: 'Golden Hour Drive', artist: 'The Sample Tapes', colors: ['#542747', '#ef996b', '#ffe1a0'] },
  { title: 'Midnight Signals', artist: 'Neon Archive', colors: ['#121b44', '#6154b8', '#b9d9ff'] },
  { title: 'Slow Tides', artist: 'Coastal Sketches', colors: ['#123c4b', '#4d9a9b', '#d0efdd'] },
];

function cover(colors, variant) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 160;
  const paint = canvas.getContext('2d');
  if (!paint) return undefined;
  const gradient = paint.createLinearGradient(0, 0, 160, 160);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(1, colors[1]);
  paint.fillStyle = gradient;
  paint.fillRect(0, 0, 160, 160);
  paint.fillStyle = colors[2];
  if (variant === 0) {
    paint.beginPath(); paint.arc(80, 68, 34, 0, Math.PI * 2); paint.fill();
    for (let y = 105; y < 160; y += 8) {
      paint.globalAlpha = (160 - y) / 100;
      paint.fillRect(0, y, 160, 2);
    }
  } else if (variant === 1) {
    paint.strokeStyle = colors[2];
    for (let radius = 14; radius < 110; radius += 13) {
      paint.globalAlpha = 1 - radius / 130;
      paint.lineWidth = 2;
      paint.beginPath(); paint.arc(108, 54, radius, 0, Math.PI * 2); paint.stroke();
    }
  } else {
    for (let y = 45; y < 190; y += 25) {
      paint.globalAlpha = 0.18;
      paint.beginPath(); paint.moveTo(0, y);
      paint.bezierCurveTo(55, y - 50, 105, y + 45, 160, y - 5);
      paint.lineTo(160, 160); paint.lineTo(0, 160); paint.fill();
    }
  }
  return canvas.toDataURL('image/jpeg', 0.85);
}

export function createPreviewMedia() {
  const playlist = tracks.map(({ title, artist, colors }, index) => ({ title, artist, artwork: cover(colors, index) }));
  let index = 0, playing = true, active = true;
  return {
    current: () => active ? { ...playlist[index], playing } : null,
    control(verb) {
      if (verb === 'media-play-pause') { playing = !active || !playing; active = true; }
      else if (verb === 'media-next' || verb === 'media-previous') {
        index = (index + (verb === 'media-next' ? 1 : -1) + playlist.length) % playlist.length;
        if (!active) playing = true;
        active = true;
      } else if (verb === 'media-stop') { active = false; playing = false; }
      else return false;
      return true;
    },
  };
}
