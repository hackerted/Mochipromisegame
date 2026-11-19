export function drawMinimap(canvas, state) {
  if (!canvas) return;
  canvas.hidden = !state?.visible;
  canvas.style.display = state?.visible ? 'block' : 'none';
  if (!state?.visible) return;

  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const center = size / 2;
  const scale = (size * 0.84) / 84;
  const px = (x) => center + x * scale;
  const py = (z) => center - z * scale;
  const roundedRect = (x, y, w, h, radius) => {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  };

  ctx.clearRect(0, 0, size, size);
  roundedRect(2, 2, size - 4, size - 4, 24);
  ctx.fillStyle = '#081329';
  ctx.fill();
  ctx.strokeStyle = '#63728b';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#254633';
  roundedRect(px(-22.6), py(22.6), 45.2 * scale, 45.2 * scale, 14);
  ctx.fill();

  ctx.strokeStyle = '#66717e';
  ctx.lineWidth = 5.6 * scale;
  ctx.lineJoin = 'round';
  roundedRect(px(-28.6), py(28.6), 57.2 * scale, 57.2 * scale, 18);
  ctx.stroke();
  ctx.strokeStyle = '#d9c99d';
  ctx.lineWidth = 1.5;
  roundedRect(px(-31.4), py(31.4), 62.8 * scale, 62.8 * scale, 20);
  ctx.stroke();
  roundedRect(px(-25.8), py(25.8), 51.6 * scale, 51.6 * scale, 16);
  ctx.stroke();

  ctx.strokeStyle = '#d5c9a4';
  ctx.lineWidth = 2.8;
  ctx.lineCap = 'round';
  const path = (points) => {
    ctx.beginPath();
    points.forEach(([x, z], i) => i ? ctx.lineTo(px(x), py(z)) : ctx.moveTo(px(x), py(z)));
    ctx.stroke();
  };
  path([[0, 0], [0, 17.5], [0, 24.7], [0, 31.2], [0, 33.1]]);
  path([[0, 12.5], [-11.5, 12.5], [-17, 12.5], [-24.7, 12.5]]);
  path([[0, 12.5], [11.5, 12.5], [17, 12.5], [24.7, 12.5]]);
  path([[0, 0], [0, -16], [0, -24.7], [0, -33.1]]);

  for (const [x, z] of [[-18, 37], [18, 37], [-37, 0], [37, 0], [-14, -37], [14, -37]]) {
    ctx.fillStyle = '#5f9870';
    ctx.beginPath();
    ctx.arc(px(x), py(z), 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  if (state.route?.length) {
    ctx.strokeStyle = '#84d9e7';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(px(state.player.x), py(state.player.z));
    for (const point of state.route) ctx.lineTo(px(point.x), py(point.z));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const home of state.homes ?? []) {
    ctx.fillStyle = home.active ? '#70d6e6' : '#8db4a0';
    ctx.beginPath();
    ctx.arc(px(home.x), py(home.z), home.active ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8f0e8';
    ctx.font = '700 9px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(home.label, px(home.x), py(home.z) - 8);
  }

  ctx.save();
  ctx.translate(px(state.player.x), py(state.player.z));
  ctx.rotate(state.player.yaw || 0);
  ctx.fillStyle = '#f7fbff';
  ctx.strokeStyle = '#213445';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(7, 7);
  ctx.lineTo(0, 4);
  ctx.lineTo(-7, 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#e9edf5';
  ctx.font = '700 11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('N', center, 17);
}
