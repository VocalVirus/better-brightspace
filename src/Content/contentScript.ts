console.log('[Better Brightspace] content script loaded');

function tint(base: string, overlay: string): string {
  return `linear-gradient(${overlay}, ${overlay}), ${base}`;
}

function pageTint(): string {
  const p = window.location.pathname.toLowerCase();
  if (p.match(/\/home\/\d/))                            return 'rgba(255,255,255,0.07)';
  if (p.includes('/dropbox') || p.includes('/submit'))  return 'rgba(0,0,0,0.08)';
  if (p.includes('/content') || p.includes('/lessons')) return 'rgba(255,200,80,0.06)';
  if (p.includes('/grades'))                            return 'rgba(80,180,255,0.05)';
  return 'rgba(0,0,0,0)';
}

function injectShadowStyle(el: Element, css: string) {
  const sr = el.shadowRoot;
  if (!sr) return;
  let s = sr.querySelector<HTMLStyleElement>('#bb-shadow');
  if (!s) { s = document.createElement('style'); s.id = 'bb-shadow'; sr.appendChild(s); }
  s.textContent = css;
}

function applyShadows() {
  // Course panel
  document.querySelectorAll('d2l-tab-panel, d2l-my-courses-content-v2, d2l-my-courses-card-grid-v2').forEach(el => {
    injectShadowStyle(el, ':host { background: rgba(255, 248, 228, 0.88) !important; }');
  });

  // Navigation — drill into d2l-labs-navigation's shadow root
  document.querySelectorAll('d2l-labs-navigation').forEach(nav => {
    injectShadowStyle(nav, ':host { background: transparent !important; }');
    const sr = nav.shadowRoot;
    if (!sr) return;

    // Inject into the nav shadow itself to clear the branding background class
    let navStyle = sr.querySelector<HTMLStyleElement>('#bb-nav-shadow');
    if (!navStyle) { navStyle = document.createElement('style'); navStyle.id = 'bb-nav-shadow'; sr.appendChild(navStyle); }
    navStyle.textContent = `
      .d2l-branding-navigation-background-color { background: transparent !important; }
      d2l-labs-navigation-main-footer { background: transparent !important; }
      .d2l-navigation-s-main-wrapper { background: transparent !important; }
    `;

    // Also force inline style directly on the element — beats any stylesheet
    sr.querySelectorAll<HTMLElement>('d2l-labs-navigation-main-footer').forEach(footer => {
      footer.style.setProperty('background', 'transparent', 'important');
      footer.style.setProperty('background-color', 'transparent', 'important');
    });

    sr.querySelectorAll('d2l-labs-navigation-main-header').forEach(hdr => {
      injectShadowStyle(hdr, `
        :host { background: transparent !important; }
        .d2l-labs-navigation-header-container,
        .d2l-labs-navigation-gutters { background: transparent !important; }
      `);
    });
  });
}

function applyBackground(background: string) {
  const existing = document.getElementById('bb-custom-background');
  if (existing) existing.remove();

  if (!background) return;

  const varied = tint(background, pageTint());

  const style = document.createElement('style');
  style.id = 'bb-custom-background';
  style.textContent = `
    html, body,
    header, nav,
    .d2l-navigation-s,
    .d2l-branding-navigation-dark-foreground-color,
    .d2l-branding-navigation-background-color,
    d2l-labs-navigation,
    d2l-labs-navigation-main-footer,
    #d2l-page-main, #d2l-page-main-content,
    .d2l-page-main, .d2l-homepage, .d2l-home,
    .d2l-course-home-main, .d2l-main-pane,
    .d2l-body-main-wrapper,
    [class*="d2l-page"], [class*="d2l-main"], [id*="d2l-page"] {
      background: ${varied} !important;
    }

    /* Announcement tiles — light DOM */
    .d2l-tile, .d2l-widget, .d2l-custom-widget {
      background: rgba(255, 255, 255, 0.82) !important;
    }
    .d2l-tile:nth-of-type(odd)  { background: rgba(255, 244, 220, 0.86) !important; }
    .d2l-tile:nth-of-type(even) { background: rgba(220, 238, 255, 0.86) !important; }
  `;
  document.head.appendChild(style);

  // Force inline style on the slotted footer (lives in light DOM, not shadow root)
  function clearFooter() {
    document.querySelectorAll<HTMLElement>('d2l-labs-navigation-main-footer').forEach(el => {
      el.style.setProperty('background', 'transparent', 'important');
      el.style.setProperty('background-color', 'transparent', 'important');
    });
  }
  clearFooter();
  setTimeout(clearFooter, 500);
  setTimeout(clearFooter, 1500);

  // Run immediately, then retry after short delays for late-upgrading components
  applyShadows();
  setTimeout(applyShadows, 500);
  setTimeout(applyShadows, 1500);
}

let currentHref = location.href;

function onNavigation() {
  if (location.href !== currentHref) {
    currentHref = location.href;
    chrome.storage.sync.get('background', (result) => {
      applyBackground((result.background as string) || '');
    });
  }
}

const _pushState = history.pushState.bind(history);
history.pushState = (...args) => { _pushState(...args); onNavigation(); };
const _replaceState = history.replaceState.bind(history);
history.replaceState = (...args) => { _replaceState(...args); onNavigation(); };
window.addEventListener('popstate', onNavigation);

chrome.storage.sync.get('background', (result) => {
  if (result.background) applyBackground(result.background as string);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.background) {
    applyBackground((changes.background.newValue as string) || '');
  }
});
