import { clamp, ease, lerp, seeded } from './drawing.js';

// This original demo is a starting point. Author this module for the actual
// audio: images, characters, actions and camera choices belong to the work.
function box(c, x, y, w, h, color) {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
function line(c, x, y, x2, y2, color, width = 2) {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x2, y2);
  c.stroke();
}
function city(c, t, w, h, variant) {
  box(c, 0, 0, w, h, '#101b2c');
  box(c, 0, 85, w, 68, '#182b39');
  box(c, 246, 24, 22, 22, '#e2c080');
  for (let i = 0; i < 15; i++) {
    const x = i * 28 - 14 - (variant === 'run' ? (t * 9) % 28 : 0),
      top = 48 + seeded(i + 8) * 40;
    box(c, x, top, 23, 153 - top, i % 2 ? '#253848' : '#20303f');
    for (let y = top + 8; y < 139; y += 14)
      for (let k = 0; k < 2; k++)
        box(c, x + 5 + k * 9, y, 3, 5, seeded(i * 10 + y + k) > 0.45 ? '#b88d5a' : '#32475a');
  }
  box(c, 0, 145, w, 11, '#475e64');
  line(c, 0, 145, w, 145, '#bba677', 1);
  box(c, 0, 153, w, 8, '#0b131f');
}
function person(c, x, y, { stride = 0, punch = 0, knee = 0, lean = 0 } = {}) {
  c.save();
  c.translate(x, y);
  c.rotate(lean);
  const hip = -11 - knee * 5,
    shoulder = -31 - knee * 5;
  line(c, -4, hip, -6 - stride * 8, -1, '#20334a', 5);
  line(c, 4, hip, 6 + stride * 8, -1, '#20334a', 5);
  box(c, -10 - stride * 8, -3, 9, 4, '#e1dcca');
  box(c, 3 + stride * 8, -3, 9, 4, '#e1dcca');
  box(c, -8, shoulder, 16, 22, '#72b1a3');
  box(c, -8, shoulder, 5, 22, '#427b7d');
  box(c, -2, shoulder + 4, 4, 10, '#d8b475');
  line(c, -8, shoulder + 4, -14 + stride * 6, shoulder + 17, '#c4967e', 4);
  line(c, 8, shoulder + 4, 18 + punch * 24, shoulder + 12 - punch * 9, '#c4967e', 4);
  box(c, 15 + punch * 24, shoulder + 9 - punch * 9, 6, 6, '#d7ad8c');
  box(c, -7, shoulder - 13, 14, 13, '#d7ad8c');
  box(c, -8, shoulder - 15, 16, 5, '#cc5a59');
  box(c, -8, shoulder - 10, 4, 6, '#101b2c');
  box(c, 3, shoulder - 7, 2, 2, '#101b2c');
  c.restore();
}
function dust(c, x, y, p) {
  for (let i = 0; i < 18; i++) {
    const a = seeded(i) * Math.PI * 2;
    c.globalAlpha = 1 - clamp(p);
    box(
      c,
      x + Math.cos(a) * p * (15 + seeded(i + 4) * 38),
      y + Math.sin(a) * p * 27 + 16 * p * p,
      2,
      2,
      '#e1bd7b',
    );
  }
  c.globalAlpha = 1;
}

export function drawScene({ ctx: c, scene, time: t, local, progress: u, width: w, height: h }) {
  c.save();
  c.scale(w / 320, h / 180);
  city(c, t, 320, 180, scene.id);
  if (scene.id === 'run') {
    const x = lerp(38, 175, ease(u));
    box(c, x - 17, 150, 34, 3, '#080f1a66');
    person(c, x, 150, { stride: Math.sin(local * 14), lean: 0.07 });
    for (let i = 0; i < 7; i++)
      box(c, 30 + ((((i * 49 - t * 28) % 330) + 330) % 330), 151, 12, 1, '#9bb6a877');
    box(c, 227, 70, 9, 75, '#ba9164');
    box(c, 227, 70, 65, 5, '#ba9164');
    for (let i = 0; i < 6; i++) box(c, 230 + i * 10, 75, 3, 70, '#8aa2a4');
  } else if (scene.id === 'gate') {
    const hit = clamp((u - 0.32) / 0.14),
      open = ease((u - 0.47) / 0.43);
    person(c, 178 + open * 18, 150, {
      punch: u < 0.32 ? -u * 0.9 : hit,
      lean: hit * 0.05,
      knee: (1 - hit) * u,
    });
    c.save();
    c.translate(223, 74);
    c.rotate(-open * 1.3);
    box(c, 0, 0, 6, 75, '#bb9163');
    box(c, 0, 0, 65, 5, '#bb9163');
    for (let i = 0; i < 6; i++) box(c, i * 10 + 1, 5, 3, 70, '#9aafae');
    c.restore();
    if (u > 0.45) dust(c, 220, 122, (u - 0.45) / 0.55);
  } else if (scene.id === 'jump') {
    box(c, 122, 145, 73, 18, '#101b2c');
    line(c, 121, 145, 121, 160, '#bca677', 1);
    line(c, 195, 145, 195, 160, '#bca677', 1);
    const flight = clamp((u - 0.18) / 0.61),
      x = lerp(70, 258, ease(flight)),
      y = 150 - Math.sin(flight * Math.PI) * 64;
    const crouch = u < 0.18 ? u / 0.18 : u > 0.79 ? (1 - clamp((u - 0.79) / 0.21)) * 0.8 : 0;
    box(c, x - 14, 150, 28, 2, '#080f1a55');
    person(c, x, y, {
      stride: flight > 0 && flight < 1 ? -0.5 : 0,
      knee: crouch,
      punch: flight > 0 && flight < 1 ? 0.3 : 0,
    });
    if (u > 0.79) dust(c, 258, 147, (u - 0.79) / 0.21);
    box(c, 281, 100, 2, 45, '#c7b17b');
    box(c, 283, 100, 22, 13, '#d26363');
  } else throw new Error(`Author an action for scene: ${scene.id}`);
  c.restore();
}
