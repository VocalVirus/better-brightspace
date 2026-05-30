console.log('[Better Brightspace] content script loaded');

// ─── Assignment prefetch ───────────────────────────────────────────────────

const BB_CACHE_KEY = 'bbAssignmentsCache';
const BB_CACHE_TTL = 5 * 60 * 1000;

function prefetchTermCode(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (month <= 4) return `${year}S`;
  if (month <= 7) return `${year}M`;
  return `${year}F`;
}

async function prefetchAssignments() {
  const stored = await chrome.storage.local.get(BB_CACHE_KEY) as Record<string, any>;
  const cached = stored[BB_CACHE_KEY];
  if (cached && Date.now() - cached.cachedAt < BB_CACHE_TTL) return;

  try {
    const enrollRes = await fetch(
      'https://brightspace.vanderbilt.edu/d2l/api/lp/1.60/enrollments/myenrollments/',
      { credentials: 'include' }
    );
    if (!enrollRes.ok) return;
    const enrollData = await enrollRes.json();

    const term = prefetchTermCode();
    const enrollments: Array<{ OrgUnit: { Id: number; Name: string; Code: string | null } }> =
      (enrollData.Items ?? []).filter((e: any) => {
        const code = e.OrgUnit.Code as string | null;
        const name = e.OrgUnit.Name as string;
        return code && name && name !== code && code.includes(term);
      });

    const assignments: Array<{
      Id: number; Name: string; DueDate: string | null;
      courseName: string; orgUnitId: number;
    }> = [];

    await Promise.all(
      enrollments.map(async (e) => {
        const res = await fetch(
          `https://brightspace.vanderbilt.edu/d2l/api/le/1.71/${e.OrgUnit.Id}/dropbox/folders/`,
          { credentials: 'include' }
        );
        if (!res.ok) return;
        const folders: Array<{ Id: number; Name: string; DueDate: string | null }> = await res.json();
        for (const f of folders) {
          assignments.push({
            Id: f.Id, Name: f.Name, DueDate: f.DueDate,
            courseName: e.OrgUnit.Name, orgUnitId: e.OrgUnit.Id,
          });
        }
      })
    );

    assignments.sort((a, b) => {
      if (!a.DueDate) return 1;
      if (!b.DueDate) return -1;
      return new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime();
    });

    chrome.storage.local.set({
      [BB_CACHE_KEY]: { assignments, enrollments, cachedAt: Date.now() },
    });
  } catch { /* silent — popup will fetch on its own if needed */ }
}

// Wait for page to settle before prefetching so we don't compete with page load
setTimeout(prefetchAssignments, 2000);

// ─── Assignment Sidebar ────────────────────────────────────────────────────

const BB_SIDEBAR_ID = 'bb-assignment-sidebar';

type SidebarAssignment = {
  Id: number; Name: string; DueDate: string | null;
  courseName: string; orgUnitId: number;
};

function sidebarDueLabel(dueDateStr: string | null): { text: string; color: string } {
  if (!dueDateStr) return { text: 'No due date', color: '#555' };
  const now = new Date();
  const due = new Date(dueDateStr);
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / 86400000);
  if (diffDays < 0)   return { text: 'Overdue',              color: '#ff5555' };
  if (diffDays === 0) return { text: 'Due today',            color: '#ff9900' };
  if (diffDays === 1) return { text: 'Due tomorrow',         color: '#ffcc00' };
  if (diffDays <= 7)  return { text: `Due in ${diffDays}d`,  color: '#ffd966' };
  return { text: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), color: '#777' };
}

function renderSidebarList(listEl: HTMLElement, assignments: SidebarAssignment[] | null) {
  if (!assignments) {
    listEl.innerHTML = '<p style="margin:6px 0;font-size:12px;color:#555;">Loading…</p>';
    return;
  }
  if (assignments.length === 0) {
    listEl.innerHTML = '<p style="margin:6px 0;font-size:12px;color:#555;">No assignments found.</p>';
    return;
  }
  listEl.innerHTML = assignments.map((a) => {
    const { text, color } = sidebarDueLabel(a.DueDate);
    const url = `https://brightspace.vanderbilt.edu/d2l/lms/dropbox/user/folder_list.d2l?ou=${a.orgUnitId}&isprv=0&bp=0`;
    return `<a href="${url}" style="display:block;padding:7px 0;border-bottom:1px solid #222;text-decoration:none;">
      <div style="font-size:12px;font-weight:600;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.Name}</div>
      <div style="font-size:10px;color:#666;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.courseName}</div>
      <div style="font-size:10px;color:${color};margin-top:1px;font-weight:500;">${text}</div>
    </a>`;
  }).join('');
}

function isHomepage(): boolean {
  const p = window.location.pathname;
  return p === '/d2l/home' || p === '/d2l/home/' || /^\/d2l\/home\/?$/.test(p);
}

let _sidebarShadow: ShadowRoot | null = null;

function buildSidebar(): ShadowRoot {
  const host = document.createElement('div');
  host.id = BB_SIDEBAR_ID;
  host.style.cssText = [
    'position:fixed', 'left:12px', 'top:80px',
    'width:230px', 'max-height:calc(100vh - 100px)',
    'z-index:99999', 'font-family:system-ui,sans-serif',
  ].join(';');

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; }
      #panel {
        background: rgba(16,16,16,0.93);
        border: 1px solid #2c2c2c;
        border-radius: 10px;
        padding: 10px 12px;
        max-height: calc(100vh - 100px);
        overflow-y: auto;
        backdrop-filter: blur(10px);
        box-shadow: 0 6px 28px rgba(0,0,0,0.45);
        scrollbar-width: thin;
        scrollbar-color: #333 transparent;
      }
      #hdr {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px solid #2a2a2a;
      }
      #title {
        font-size: 10px; font-weight: 700; color: #b3a369;
        text-transform: uppercase; letter-spacing: 1px;
      }
      #close {
        background: none; border: none; color: #444; cursor: pointer;
        font-size: 16px; padding: 0; line-height: 1;
      }
      #close:hover { color: #aaa; }
    </style>
    <div id="panel">
      <div id="hdr">
        <span id="title">Assignments</span>
        <button id="close" title="Hide">×</button>
      </div>
      <div id="list"><p style="margin:6px 0;font-size:12px;color:#555;">Loading…</p></div>
    </div>`;

  shadow.getElementById('close')!.addEventListener('click', () => {
    host.remove();
    _sidebarShadow = null;
  });

  document.body.appendChild(host);
  return shadow;
}

function injectSidebar() {
  if (!isHomepage()) {
    document.getElementById(BB_SIDEBAR_ID)?.remove();
    _sidebarShadow = null;
    return;
  }
  if (!_sidebarShadow) {
    _sidebarShadow = buildSidebar();
  }
  const listEl = _sidebarShadow.getElementById('list') as HTMLElement;

  chrome.storage.local.get(BB_CACHE_KEY, (stored) => {
    const cached = stored[BB_CACHE_KEY] as { assignments: SidebarAssignment[] } | undefined;
    renderSidebarList(listEl, cached?.assignments ?? null);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

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
      d2l-labs-navigation-main-footer { background: transparent !important; border: none !important; }
      .d2l-navigation-s-main-wrapper { background: transparent !important; }
      :host { border: none !important; }
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
      el.style.setProperty('border', 'none', 'important');
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

// ─── Grade badges on course cards ─────────────────────────────────────────

function gradeLetterCS(pct: number): string {
  if (pct >= 93) return 'A';   if (pct >= 90) return 'A-';
  if (pct >= 87) return 'B+';  if (pct >= 83) return 'B';
  if (pct >= 80) return 'B-';  if (pct >= 77) return 'C+';
  if (pct >= 73) return 'C';   if (pct >= 70) return 'C-';
  if (pct >= 67) return 'D+';  if (pct >= 63) return 'D';
  if (pct >= 60) return 'D-';  return 'F';
}

function gradeColorCS(pct: number): string {
  const l = gradeLetterCS(pct);
  if (l[0] === 'A') return '#4caf50';
  if (l[0] === 'B') return '#8bc34a';
  if (l[0] === 'C') return '#ffcc00';
  if (l[0] === 'D') return '#ff9900';
  return '#ff5555';
}

let _gradeMapCache: Record<number, number | null> | null = null;

async function fetchGradeMap(): Promise<Record<number, number | null>> {
  if (_gradeMapCache) return _gradeMapCache;

  const gradeMap: Record<number, number | null> = {};

  try {
    const whoamiRes = await fetch('https://brightspace.vanderbilt.edu/d2l/api/lp/1.60/users/whoami', { credentials: 'include' });
    if (whoamiRes.ok) {
      const whoami = await whoamiRes.json();
      const userId = String(whoami.Identifier);

      const enrollRes = await fetch('https://brightspace.vanderbilt.edu/d2l/api/lp/1.60/enrollments/myenrollments/', { credentials: 'include' });
      if (enrollRes.ok) {
        const enrollData = await enrollRes.json();
        const enrollments: Array<{ OrgUnit: { Id: number } }> = enrollData.Items ?? [];

        await Promise.all(enrollments.map(async (en) => {
          const id = en.OrgUnit.Id;
          try {
            const res = await fetch(
              `https://brightspace.vanderbilt.edu/d2l/api/le/1.71/${id}/grades/final/values/${userId}/`,
              { credentials: 'include' }
            );
            if (!res.ok) { gradeMap[id] = null; return; }
            const d = await res.json();
            if (d.PointsNumerator != null && d.PointsDenominator > 0)
              gradeMap[id] = (d.PointsNumerator / d.PointsDenominator) * 100;
            else if (d.WeightedNumerator != null && d.WeightedDenominator > 0)
              gradeMap[id] = (d.WeightedNumerator / d.WeightedDenominator) * 100;
            else
              gradeMap[id] = null;
          } catch {
            gradeMap[id] = null;
          }
        }));
      }
    }
  } catch { /* fall through to storage fallback */ }

  // Fill in any missing grades from the GPA calculator's computed results
  await new Promise<void>((resolve) => {
    chrome.storage.sync.get('bbComputedGrades', (result) => {
      const computed = (result.bbComputedGrades ?? {}) as Record<string, number>;
      for (const [id, pct] of Object.entries(computed)) {
        const numId = parseInt(id, 10);
        if (gradeMap[numId] == null) gradeMap[numId] = pct;
      }
      resolve();
    });
  });

  _gradeMapCache = gradeMap;
  return gradeMap;
}

function injectBadgeIntoRoot(root: Document | ShadowRoot, gradeMap: Record<number, number | null>) {
  const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/d2l/home/"]'));
  for (const a of anchors) {
    const match = a.href.match(/\/d2l\/home\/(\d+)/);
    if (!match) continue;
    const orgId = parseInt(match[1], 10);
    const pct = gradeMap[orgId];
    if (pct == null || isNaN(pct)) continue;

    const anchorRoot = a.getRootNode() as Document | ShadowRoot;
    if (anchorRoot.querySelector(`.bb-grade-badge[data-bb-org="${orgId}"]`)) continue;

    const letter = gradeLetterCS(pct);
    const color = gradeColorCS(pct);

    const badge = document.createElement('div');
    badge.className = 'bb-grade-badge';
    badge.setAttribute('data-bb-org', String(orgId));
    badge.style.cssText = `position:absolute;bottom:8px;right:8px;background:rgba(20,20,20,0.85);color:${color};font-size:12px;font-weight:700;padding:3px 8px;border-radius:5px;pointer-events:none;z-index:999;font-family:system-ui,sans-serif;line-height:1.5;letter-spacing:0.2px;`;
    badge.textContent = `${pct.toFixed(1)}% ${letter}`;

    if (anchorRoot instanceof ShadowRoot) {
      if (!anchorRoot.querySelector('#bb-grade-host-style')) {
        const s = document.createElement('style');
        s.id = 'bb-grade-host-style';
        s.textContent = ':host { position: relative !important; }';
        anchorRoot.appendChild(s);
      }
      anchorRoot.appendChild(badge);
    } else {
      const container = (
        a.closest('d2l-enrollment-card') ||
        a.closest('li') ||
        a.closest('[class*="card"]') ||
        a.parentElement
      ) as HTMLElement | null;
      if (!container) continue;
      if (container.querySelector(`.bb-grade-badge[data-bb-org="${orgId}"]`)) continue;
      if (window.getComputedStyle(container).position === 'static') container.style.position = 'relative';
      container.appendChild(badge);
    }
  }
}

function walkShadowRoots(root: Document | ShadowRoot, callback: (r: Document | ShadowRoot) => void) {
  callback(root);
  root.querySelectorAll('*').forEach(el => {
    if (el.shadowRoot) walkShadowRoots(el.shadowRoot, callback);
  });
}

async function tryInjectGradeBadges() {
  const gradeMap = await fetchGradeMap();
  if (Object.keys(gradeMap).length === 0) return;
  walkShadowRoots(document, (root) => injectBadgeIntoRoot(root, gradeMap));
}

// ─────────────────────────────────────────────────────────────────────────────

let currentHref = location.href;

function onNavigation() {
  if (location.href !== currentHref) {
    currentHref = location.href;
    chrome.storage.sync.get('background', (result) => {
      applyBackground((result.background as string) || '');
    });
    [500, 1500, 3000].forEach(d => setTimeout(tryInjectGradeBadges, d));
    injectSidebar();
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

injectSidebar();
[500, 1500, 3000, 6000].forEach(d => setTimeout(tryInjectGradeBadges, d));

chrome.storage.onChanged.addListener((changes, area) => {
  if (changes.background) {
    applyBackground((changes.background.newValue as string) || '');
  }
  if (changes.bbComputedGrades) {
    _gradeMapCache = null;
    tryInjectGradeBadges();
  }
  if (area === 'local' && changes[BB_CACHE_KEY] && _sidebarShadow) {
    const listEl = _sidebarShadow.getElementById('list') as HTMLElement;
    const newCache = changes[BB_CACHE_KEY].newValue as { assignments: SidebarAssignment[] } | undefined;
    renderSidebarList(listEl, newCache?.assignments ?? null);
  }
});
