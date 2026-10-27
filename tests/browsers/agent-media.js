// Mídia sintética para revisar o agente no navegador (vite dev serve este arquivo):
// vídeo WebM de 4 s via MediaRecorder (sem duração no cabeçalho, como gravações reais),
// WAV com cliques a 120 BPM sobre um grave contínuo e um PNG com alpha.
window.__makeMedia = async function makeMedia() {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 568;
  const g = canvas.getContext('2d');
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm;codecs=vp9' });
  const chunks = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  recorder.start();
  const t0 = performance.now();
  await new Promise((resolve) => {
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      g.fillStyle = `hsl(${t * 90},70%,40%)`; g.fillRect(0, 0, 320, 568);
      g.fillStyle = '#fff'; g.font = '80px sans-serif'; g.fillText(t.toFixed(1), 60, 300);
      // setTimeout em vez de rAF: o painel do navegador pode estar oculto.
      if (t < 4) setTimeout(loop, 33); else resolve();
    };
    loop();
  });
  recorder.stop();
  await new Promise((resolve) => { recorder.onstop = resolve; });
  const video = new File(chunks, 'selva.webm', { type: 'video/webm' });

  const rate = 44100, n = rate * 8, buffer = new ArrayBuffer(44 + n * 2), view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate, beat = t % .5;
    const s = (beat < .05 ? Math.sin(2 * Math.PI * 880 * t) * (1 - beat / .05) * .8 : 0) + Math.sin(2 * Math.PI * 110 * t) * .15;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true);
  }
  const audio = new File([buffer], 'batida.wav', { type: 'audio/wav' });

  const pc = document.createElement('canvas');
  pc.width = 200; pc.height = 200;
  const pg = pc.getContext('2d');
  pg.fillStyle = 'rgba(255,220,0,0.9)'; pg.beginPath(); pg.arc(100, 100, 90, 0, 7); pg.fill();
  const png = await new Promise((resolve) => pc.toBlob((blob) => resolve(new File([blob], 'sol.png', { type: 'image/png' }))));
  return [video, audio, png];
};

// Faz o próximo "Importar mídia" receber estes arquivos, como se a pessoa os escolhesse.
window.__importMedia = async function importMedia(files) {
  const original = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function click() {
    if (this.type !== 'file') return original.call(this);
    HTMLInputElement.prototype.click = original;
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    this.files = transfer.files;
    this.dispatchEvent(new Event('change', { bubbles: true }));
  };
  document.querySelector('[data-bin-import]').click();
};

// Cria um projeto pelo formulário de abertura, como a pessoa faria.
window.__newProject = async function newProject(values) {
  document.querySelector('[data-language="pt-BR"]')?.click();
  document.querySelector('#new-project').click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  for (const [name, value] of Object.entries(values)) {
    const field = document.querySelector(`#setup-form [name="${name}"]`);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.querySelector('#setup-form button[type="submit"]').click();
  await new Promise((resolve) => setTimeout(resolve, 500));
};
