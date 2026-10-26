const status = document.querySelector('#status');
try {
  await import('./vrml-viewer.js?v=animation-1');
  const viewer = document.querySelector('vrml-viewer');
  viewer.addEventListener('vrml-error', event => { status.textContent = event.detail.message; });
  viewer.addEventListener('vrml-load', () => { status.textContent = ''; });
  const source = new URLSearchParams(location.search).get('src') || 'stolik/originals/stolik7.wrl';
  const url = new URL(source, location.href);
  const directory = new URL('./', location.href);
  if (url.origin !== directory.origin || !url.pathname.startsWith(directory.pathname)) {
    throw new Error('Choose a model hosted inside this viewer’s site directory.');
  }
  await viewer.load(url.href);
} catch (error) {
  status.textContent = `Could not open the model: ${error.message}`;
}
