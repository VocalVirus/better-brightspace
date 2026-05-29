console.log('[Better Brightspace] content script loaded');

// Apply the saved background, if any
function applyBackground(background: string) {
  // Remove any previously injected style so we don't stack them
  const existing = document.getElementById('bb-custom-background');
  if (existing) existing.remove();

  if (!background) return;

  const style = document.createElement('style');
  style.id = 'bb-custom-background';
  style.textContent = `
    body, .d2l-page-main, .d2l-homepage {
      background: ${background} !important;
    }
  `;
  document.head.appendChild(style);
}

chrome.storage.sync.get('background', (result) => {
  if (result.background) {
    applyBackground(result.background as string);
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.background) {
    applyBackground(changes.background.newValue as string);
  }
});