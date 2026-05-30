import { useEffect, useRef, useState } from 'react';
import { getCourseGrade, getCourseGradeItems, type BrightspaceGradeItem, type Enrollment } from './lib/api';

// Stored per-course in chrome.storage
type CourseData = {
  creditHours: number | null;
  weights: Record<string, number>;  // brightspace item id → weight % of course grade
  customItems: CustomItem[];
};

type CustomItem = {
  id: string;
  name: string;
  pct: number;
  weight: number;
};

function letterGrade(pct: number): string {
  if (pct >= 93) return 'A';
  if (pct >= 90) return 'A-';
  if (pct >= 87) return 'B+';
  if (pct >= 83) return 'B';
  if (pct >= 80) return 'B-';
  if (pct >= 77) return 'C+';
  if (pct >= 73) return 'C';
  if (pct >= 70) return 'C-';
  if (pct >= 67) return 'D+';
  if (pct >= 63) return 'D';
  if (pct >= 60) return 'D-';
  return 'F';
}

function letterColor(letter: string): string {
  if (letter.startsWith('A')) return '#4caf50';
  if (letter.startsWith('B')) return '#8bc34a';
  if (letter.startsWith('C')) return '#ffcc00';
  if (letter.startsWith('D')) return '#ff9900';
  return '#ff5555';
}

function letterToGpa(letter: string): number {
  const map: Record<string, number> = {
    'A': 4.0, 'A-': 3.7, 'B+': 3.3, 'B': 3.0, 'B-': 2.7,
    'C+': 2.3, 'C': 2.0, 'C-': 1.7, 'D+': 1.3, 'D': 1.0, 'D-': 0.7, 'F': 0.0,
  };
  return map[letter] ?? 0.0;
}

const STORAGE_KEY = 'courseGradeData';

interface Props {
  enrollments: Enrollment[];
}

export default function GpaCalculator({ enrollments }: Props) {
  const [courseData, setCourseData] = useState<Record<string, CourseData>>({});
  const [fetchedGrades, setFetchedGrades] = useState<Record<string, number | null>>({});
  const [gradesLoading, setGradesLoading] = useState(false);

  // Per-class view
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [classItems, setClassItems] = useState<Record<string, BrightspaceGradeItem[] | null>>({});
  const [classItemsLoading, setClassItemsLoading] = useState(false);

  // Inline weight drafts (key = `${orgId}:${itemId}`, value = string in progress)
  const [weightDrafts, setWeightDrafts] = useState<Record<string, string>>({});

  // Inline credit-hour editing
  const [editingCrHrs, setEditingCrHrs] = useState<string | null>(null);
  const [crHrsInput, setCrHrsInput] = useState('');

  // Custom item add form
  const [customName, setCustomName] = useState('');
  const [customPct, setCustomPct] = useState('');
  const [customEarned, setCustomEarned] = useState('');
  const [customPossible, setCustomPossible] = useState('');
  const [customWeight, setCustomWeight] = useState('');
  const [customMode, setCustomMode] = useState<'pct' | 'points'>('pct');
  const customNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chrome.storage.sync.get(STORAGE_KEY, (result) => {
      if (result[STORAGE_KEY]) {
        const stored = result[STORAGE_KEY] as Record<string, any>;
        // Migrate old format: items[] → customItems[], weights: {}
        const migrated: Record<string, CourseData> = {};
        for (const [id, v] of Object.entries(stored)) {
          migrated[id] = {
            creditHours: v.creditHours ?? null,
            weights: v.weights ?? {},
            customItems: v.customItems ?? (v.items ?? []),
          };
        }
        setCourseData(migrated);
      }
    });
  }, []);

  // Fetch final grades for GPA summary (lazy, once enrollments are ready)
  useEffect(() => {
    if (enrollments.length === 0) return;
    setGradesLoading(true);
    Promise.all(
      enrollments.map(async (en) => ({
        id: String(en.OrgUnit.Id),
        grade: await getCourseGrade(en.OrgUnit.Id).catch(() => null),
      }))
    ).then((results) => {
      const map: Record<string, number | null> = {};
      results.forEach(({ id, grade }) => { map[id] = grade; });
      setFetchedGrades(map);
      setGradesLoading(false);
    });
  }, [enrollments]);

  // Fetch individual graded items when entering a per-class view
  useEffect(() => {
    if (!selectedOrgId || classItems[selectedOrgId] !== undefined) return;
    setClassItemsLoading(true);
    getCourseGradeItems(Number(selectedOrgId))
      .then((items) => {
        setClassItems((prev) => ({ ...prev, [selectedOrgId]: items }));
        setClassItemsLoading(false);
      })
      .catch(() => {
        setClassItems((prev) => ({ ...prev, [selectedOrgId]: null }));
        setClassItemsLoading(false);
      });
  }, [selectedOrgId]);

  function save(updated: Record<string, CourseData>) {
    setCourseData(updated);
    chrome.storage.sync.set({ [STORAGE_KEY]: updated });
  }

  function getOrInit(orgId: string): CourseData {
    return courseData[orgId] ?? { creditHours: null, weights: {}, customItems: [] };
  }

  function setCreditHours(orgId: string, hours: number) {
    save({ ...courseData, [orgId]: { ...getOrInit(orgId), creditHours: hours } });
  }

  function saveWeight(orgId: string, itemId: string, weight: number) {
    const c = getOrInit(orgId);
    save({ ...courseData, [orgId]: { ...c, weights: { ...c.weights, [itemId]: weight } } });
  }

  function addCustomItem(orgId: string) {
    const pct = customMode === 'points'
      ? (parseFloat(customEarned) / parseFloat(customPossible)) * 100
      : parseFloat(customPct);
    const c = getOrInit(orgId);
    save({
      ...courseData,
      [orgId]: {
        ...c,
        customItems: [...c.customItems, { id: crypto.randomUUID(), name: customName.trim() || 'Untitled', pct, weight: parseFloat(customWeight) }],
      },
    });
    setCustomName(''); setCustomPct(''); setCustomEarned(''); setCustomPossible(''); setCustomWeight('');
    customNameRef.current?.focus();
  }

  function removeCustomItem(orgId: string, itemId: string) {
    const c = getOrInit(orgId);
    save({ ...courseData, [orgId]: { ...c, customItems: c.customItems.filter((i) => i.id !== itemId) } });
  }

  // Compute grade for a course from items + weights + custom items
  function gradeInfo(orgId: string): { pct: number; weightEntered: number; source: 'computed' | 'brightspace' } | null {
    const data = courseData[orgId];
    const weights = data?.weights ?? {};
    const customItems = data?.customItems ?? [];
    const items = classItems[orgId];

    // Brightspace items with weights set
    const bsContribs = (items ?? [])
      .filter((i) => weights[i.id] != null)
      .map((i) => ({ pct: i.pct, weight: weights[i.id] }));

    // Custom items always contribute
    const customContribs = customItems.map((i) => ({ pct: i.pct, weight: i.weight }));

    const all = [...bsContribs, ...customContribs];
    if (all.length > 0) {
      const weightEntered = all.reduce((s, c) => s + c.weight, 0);
      const pct = all.reduce((s, c) => s + c.pct * c.weight, 0) / weightEntered;
      return { pct, weightEntered, source: 'computed' };
    }

    // Fall back to Brightspace final grade
    const fetched = fetchedGrades[orgId];
    return fetched != null ? { pct: fetched, weightEntered: 100, source: 'brightspace' } : null;
  }

  // Persist computed grades to storage so the content script can use them for badges
  useEffect(() => {
    if (enrollments.length === 0) return;
    const computed: Record<string, number> = {};
    for (const en of enrollments) {
      const id = String(en.OrgUnit.Id);
      const g = gradeInfo(id);
      if (g) computed[id] = g.pct;
    }
    if (Object.keys(computed).length > 0) {
      chrome.storage.sync.set({ bbComputedGrades: computed });
    }
  }, [courseData, fetchedGrades, classItems, enrollments]);

  // Semester GPA
  const gpaResult = (() => {
    const contributors = enrollments.flatMap((en) => {
      const id = String(en.OrgUnit.Id);
      const hrs = courseData[id]?.creditHours;
      const g = gradeInfo(id);
      return hrs && g ? [{ creditHours: hrs, letter: letterGrade(g.pct) }] : [];
    });
    if (contributors.length === 0) return null;
    const totalHours = contributors.reduce((s, c) => s + c.creditHours, 0);
    return { gpa: contributors.reduce((s, c) => s + letterToGpa(c.letter) * c.creditHours, 0) / totalHours, totalHours };
  })();

  const isCustomValid = customMode === 'pct'
    ? Boolean(customName && customPct && customWeight)
    : Boolean(customName && customEarned && customPossible && customWeight);

  // ── Course list ──────────────────────────────────────────────────────────
  if (!selectedOrgId) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1c1c1c', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px' }}>
          {gpaResult ? (
            <>
              <div>
                <span style={{ fontSize: '22px', fontWeight: 700, color: '#b3a369' }}>{gpaResult.gpa.toFixed(2)}</span>
                <span style={{ fontSize: '11px', color: '#555', marginLeft: '8px' }}>GPA · {gpaResult.totalHours} credit hrs</span>
              </div>
              <span style={{ fontSize: '11px', color: '#555' }}>Semester</span>
            </>
          ) : (
            <span style={{ fontSize: '13px', color: '#555' }}>
              {gradesLoading ? 'Fetching grades…' : 'Set credit hours to calculate GPA'}
            </span>
          )}
        </div>

        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {enrollments.map((en) => {
            const orgId = String(en.OrgUnit.Id);
            const data = courseData[orgId];
            const g = gradeInfo(orgId);
            const letter = g ? letterGrade(g.pct) : null;
            const isEditing = editingCrHrs === orgId;

            return (
              <li key={orgId} style={{ borderBottom: '1px solid #222', padding: '8px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <button
                      onClick={() => setSelectedOrgId(orgId)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', width: '100%', display: 'block' }}
                      title="View grade details"
                    >
                      {en.OrgUnit.Name}
                    </button>
                    <div style={{ marginTop: '3px' }}>
                      {isEditing ? (
                        <input
                          type="number"
                          value={crHrsInput}
                          onChange={(e) => setCrHrsInput(e.target.value)}
                          onBlur={() => {
                            const v = parseFloat(crHrsInput);
                            if (!isNaN(v) && v > 0) setCreditHours(orgId, v);
                            setEditingCrHrs(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') setEditingCrHrs(null);
                          }}
                          autoFocus
                          min={0.5}
                          step={0.5}
                          style={{ ...inputStyle, width: '80px', fontSize: '11px', padding: '2px 6px' }}
                          placeholder="credit hrs"
                        />
                      ) : (
                        <button
                          onClick={() => { setEditingCrHrs(orgId); setCrHrsInput(data?.creditHours ? String(data.creditHours) : ''); }}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '11px', color: data?.creditHours ? '#555' : '#b3a369', textDecoration: data?.creditHours ? 'none' : 'underline' }}
                        >
                          {data?.creditHours ? `${data.creditHours} cr` : 'Set credit hrs'}
                        </button>
                      )}
                    </div>
                  </div>
                  {g ? (
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: letterColor(letter!) }}>{g.pct.toFixed(1)}%</div>
                      <div style={{ fontSize: '11px', color: letterColor(letter!), marginTop: '1px' }}>{letter}</div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#444', flexShrink: 0 }}>{gradesLoading ? '…' : '—'}</div>
                  )}
                  <button
                    onClick={() => setSelectedOrgId(orgId)}
                    style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                    title="Open grade calculator"
                  >›</button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  // ── Per-class calculator ─────────────────────────────────────────────────
  const orgId = selectedOrgId;
  const data = getOrInit(orgId);
  const items = classItems[orgId];
  const g = gradeInfo(orgId);
  const letter = g ? letterGrade(g.pct) : null;
  const selectedEnrollment = enrollments.find((en) => String(en.OrgUnit.Id) === orgId);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <button
          onClick={() => setSelectedOrgId(null)}
          style={{ background: 'none', border: 'none', color: '#b3a369', cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: 0, flexShrink: 0 }}
        >‹</button>
        <div style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 700, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedEnrollment?.OrgUnit.Name}
        </div>
        {g && (
          <div style={{ flexShrink: 0 }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: letterColor(letter!) }}>{g.pct.toFixed(1)}%</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: letterColor(letter!), marginLeft: '5px' }}>{letter}</span>
          </div>
        )}
      </div>

      {g && (
        <div style={{ fontSize: '11px', color: '#555', marginBottom: '10px', paddingLeft: '28px' }}>
          {g.source === 'brightspace'
            ? 'Brightspace final grade — add weights below to calculate manually'
            : `${g.weightEntered.toFixed(0)}% of course grade weighted`}
        </div>
      )}

      {/* Brightspace items */}
      {classItemsLoading && (
        <p style={{ fontSize: '12px', color: '#555', margin: '8px 0' }}>Loading assignments…</p>
      )}

      {!classItemsLoading && items && items.length > 0 && (
        <>
          <div style={{ fontSize: '10px', color: '#444', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px' }}>
            From Brightspace — add weights
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
            {items.map((item) => {
              const draftKey = `${orgId}:${item.id}`;
              const savedWeight = data.weights[item.id];
              const draftVal = weightDrafts[draftKey] ?? (savedWeight != null ? String(savedWeight) : '');
              const ltr = letterGrade(item.pct);

              return (
                <li key={item.id} style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1e1e1e', gap: '6px' }}>
                  {/* Name */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: '11px', color: '#555', marginTop: '1px' }}>
                      {item.pointsEarned % 1 === 0 && item.pointsPossible % 1 === 0
                        ? `${item.pointsEarned} / ${item.pointsPossible} pts`
                        : `${item.pointsEarned.toFixed(1)} / ${item.pointsPossible.toFixed(1)} pts`}
                    </div>
                  </div>

                  {/* Score */}
                  <span style={{ fontSize: '12px', fontWeight: 700, color: letterColor(ltr), flexShrink: 0, minWidth: '38px', textAlign: 'right' }}>
                    {item.pct.toFixed(1)}%
                  </span>

                  {/* Weight input */}
                  <div style={{ position: 'relative', flexShrink: 0, width: '56px' }}>
                    <input
                      type="number"
                      value={draftVal}
                      placeholder="wt"
                      onChange={(e) => setWeightDrafts((prev) => ({ ...prev, [draftKey]: e.target.value }))}
                      onBlur={() => {
                        const n = parseFloat(draftVal);
                        if (!isNaN(n) && n > 0) saveWeight(orgId, item.id, n);
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      min={0.1}
                      step="any"
                      style={{ ...inputStyle, paddingRight: '18px', fontSize: '11px', padding: '4px 18px 4px 6px', borderColor: savedWeight != null ? '#2a2a2a' : '#3a3a1a' }}
                    />
                    <span style={{ position: 'absolute', right: '5px', top: '50%', transform: 'translateY(-50%)', color: '#555', fontSize: '10px', pointerEvents: 'none' }}>%</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {!classItemsLoading && items !== null && items?.length === 0 && (
        <p style={{ fontSize: '12px', color: '#555', margin: '0 0 12px' }}>No graded assignments found on Brightspace yet.</p>
      )}

      {!classItemsLoading && items === null && (
        <p style={{ fontSize: '12px', color: '#555', margin: '0 0 12px' }}>Could not load assignments from Brightspace.</p>
      )}

      {/* Custom items */}
      {data.customItems.length > 0 && (
        <>
          <div style={{ fontSize: '10px', color: '#444', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px', marginTop: '4px' }}>
            Custom
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
            {data.customItems.map((item) => {
              const ltr = letterGrade(item.pct);
              return (
                <li key={item.id} style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1e1e1e', gap: '6px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                    <div style={{ fontSize: '11px', color: '#555', marginTop: '1px' }}>{item.weight}% of grade</div>
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: letterColor(ltr), flexShrink: 0, minWidth: '38px', textAlign: 'right' }}>{item.pct.toFixed(1)}%</span>
                  <button
                    onClick={() => removeCustomItem(orgId, item.id)}
                    style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                  >×</button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* Add custom item */}
      <div style={{ background: '#1c1c1c', borderRadius: '8px', padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Add custom</span>
          <div style={{ display: 'flex', background: '#111', borderRadius: '5px', padding: '2px', gap: '2px' }}>
            {(['pct', 'points'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setCustomMode(m)} style={{
                padding: '3px 6px', fontSize: '10px', fontWeight: 600, border: 'none',
                borderRadius: '4px', cursor: 'pointer', outline: 'none',
                background: customMode === m ? '#b3a369' : 'transparent',
                color: customMode === m ? '#111' : '#555',
              }}>
                {m === 'pct' ? '%' : 'pts'}
              </button>
            ))}
          </div>
        </div>

        <input
          ref={customNameRef}
          placeholder="Name (e.g. Extra Credit)"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          style={inputStyle}
        />
        <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
          {customMode === 'pct' ? (
            <div style={{ flex: 2, position: 'relative' }}>
              <input type="number" placeholder="Score" value={customPct} onChange={(e) => setCustomPct(e.target.value)}
                style={{ ...inputStyle, paddingRight: '20px' }} min={0} max={100} step="any" />
              <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', color: '#555', fontSize: '11px', pointerEvents: 'none' }}>%</span>
            </div>
          ) : (
            <>
              <input type="number" placeholder="Earned" value={customEarned} onChange={(e) => setCustomEarned(e.target.value)}
                style={{ ...inputStyle, flex: 1 }} min={0} step="any" />
              <span style={{ color: '#444', alignSelf: 'center', fontSize: '14px' }}>/</span>
              <input type="number" placeholder="Total" value={customPossible} onChange={(e) => setCustomPossible(e.target.value)}
                style={{ ...inputStyle, flex: 1 }} min={0.01} step="any" />
            </>
          )}
          <div style={{ flex: 1, position: 'relative' }}>
            <input type="number" placeholder="Weight" value={customWeight} onChange={(e) => setCustomWeight(e.target.value)}
              style={{ ...inputStyle, paddingRight: '18px' }} min={0.1} step="any" />
            <span style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', color: '#555', fontSize: '10px', pointerEvents: 'none' }}>%</span>
          </div>
        </div>
        <button
          type="button"
          disabled={!isCustomValid}
          onClick={() => addCustomItem(orgId)}
          style={{ ...btnStyle, width: '100%', marginTop: '8px', background: '#b3a369', color: '#111', opacity: isCustomValid ? 1 : 0.35 }}
        >
          Add Custom
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#111',
  border: '1px solid #2a2a2a',
  borderRadius: '5px',
  color: '#ddd',
  fontSize: '12px',
  padding: '6px 8px',
  outline: 'none',
};

const btnStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: '12px',
  fontWeight: 600,
  border: 'none',
  borderRadius: '5px',
  cursor: 'pointer',
  outline: 'none',
};
