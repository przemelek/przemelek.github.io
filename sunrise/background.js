chrome.app.runtime.onLaunched.addListener(function() {
  chrome.app.window.create('sunrise.html', {
    'bounds': {
      'width': 400,
      'height': 350
    }
  });
});
