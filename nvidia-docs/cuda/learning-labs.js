'use strict';
// Pure teaching models: no device-specific performance claims.
function pipelineModel(n, load, compute) {
  const transfers = [], calculations = [], free = [0, 0];
  let loadEnd = 0, computeEnd = 0;
  for (let i = 0; i < n; i++) {
    const start = Math.max(loadEnd, free[i % 2]);
    loadEnd = start + load;
    transfers.push({tile: i + 1, start, end: loadEnd});
    const cstart = Math.max(computeEnd, loadEnd);
    computeEnd = cstart + compute;
    calculations.push({tile: i + 1, start: cstart, end: computeEnd});
    free[i % 2] = computeEnd;
  }
  return {transfers, calculations, serial: n * (load + compute), total: computeEnd};
}
function rooflineModel(peak, bandwidth, intensity) {
  return {ceiling: Math.min(peak, bandwidth * intensity), ridge: peak / bandwidth,
    bound: bandwidth * intensity < peak ? '带宽受限' : bandwidth * intensity > peak ? '计算受限' : '位于转折点'};
}
if (typeof module !== 'undefined') module.exports = {pipelineModel, rooflineModel};
if (typeof document !== 'undefined') {
  const el = id => document.getElementById(id);
  function drawPipeline() {
    const n = +el('tiles').value, l = +el('load-time').value, c = +el('compute-time').value;
    el('tiles-value').textContent = n;
    el('load-value').textContent = l;
    el('compute-value').textContent = c;
    const m = pipelineModel(n, l, c);
    const chart = el('pipeline-chart'); chart.replaceChildren();
    for (const [label, data, kind] of [['搬运', m.transfers, 'load'], ['计算', m.calculations, 'compute']]) {
      const row = document.createElement('div'); row.className = 'timeline-row';
      const name = document.createElement('span'); name.textContent = label;
      const track = document.createElement('div'); track.className = 'track';
      for (const item of data) {
        const bar = document.createElement('span'); bar.className = 'bar ' + kind;
        bar.style.left = item.start / m.total * 100 + '%';
        bar.style.width = (item.end - item.start) / m.total * 100 + '%';
        bar.textContent = item.tile;
        bar.title = `${label} tile ${item.tile}: ${item.start} → ${item.end}`;
        bar.setAttribute('aria-label', bar.title); track.append(bar);
      }
      row.append(name, track); chart.append(row);
    }
    const scale = document.createElement('p'); scale.className = 'timeline-scale';
    scale.textContent = `时间轴 0 → ${m.total}（两行使用相同刻度）`; chart.append(scale);
    el('pipeline-result').textContent = `串行 ${m.serial} → 双缓冲 ${m.total} 时间单位；理想加速 ${(m.serial / m.total).toFixed(2)}×。稳态节拍 ${Math.max(l,c)}，首尾开销仍然存在。`;
  }
  function drawRoofline() {
    const values = ['peak', 'bandwidth', 'intensity'].map(id => el(id));
    if (values.some(input => !input.value || !input.checkValidity())) {
      el('roofline-result').textContent = '请输入范围内的正数。'; return;
    }
    const m = rooflineModel(...values.map(input => +input.value));
    el('roofline-result').textContent = `理想吞吐上界 ${m.ceiling.toLocaleString('zh-CN', {maximumFractionDigits:2})} TFLOP/s · ${m.bound}。转折点 I = ${m.ridge.toFixed(2)} FLOP/byte。实际吞吐还会低于这个理想上界。`;
  }
  ['tiles', 'load-time', 'compute-time'].forEach(id => el(id).addEventListener('input', drawPipeline));
  ['peak', 'bandwidth', 'intensity'].forEach(id => el(id).addEventListener('input', drawRoofline));
  drawPipeline(); drawRoofline();
}
