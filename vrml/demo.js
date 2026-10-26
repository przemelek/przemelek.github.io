const status = document.querySelector('#status');
try {
  await import('./vrml-viewer.js?v=animation-1');
  const viewer = document.querySelector('vrml-viewer');
  if (!viewer.renderer) throw new Error(viewer.status.textContent || 'WebGL is unavailable');
  viewer.addEventListener('vrml-load', () => { status.textContent = 'Scene ready'; });
  viewer.addEventListener('vrml-error', event => { status.textContent = event.detail.message; });
  document.querySelector('#fit').onclick = () => viewer.fit();
  let selection = 0;
  document.querySelector('#demo').onclick = () => {
    ++selection;
    viewer.load('stolik/originals/stolik7.wrl').catch(() => {});
  };
  document.querySelector('#file').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    const current = ++selection;
    try {
      const source = await file.text();
      if (current !== selection) return;
      viewer.setSource(source);
      status.textContent = file.name;
    } catch (error) {
      status.textContent = error.message;
    }
  };
} catch (error) {
  status.textContent = `Viewer could not start: ${error.message}. Check WebGL support and the browser console.`;
}
