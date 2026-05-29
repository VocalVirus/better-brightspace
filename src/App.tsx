import { useEffect, useState } from 'react';
import { getCurrentCourses, getAllAssignments, type Enrollment, type Assignment } from './lib/api';
import './App.css';

const PRESETS = [
  { label: 'Default',    value: '',                                                   preview: '#e8e8e8' },
  { label: 'Vandy Gold', value: 'linear-gradient(135deg, #1a1a1a, #b3a369)',          preview: 'linear-gradient(135deg, #1a1a1a, #b3a369)' },
  { label: 'Midnight',   value: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)', preview: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' },
  { label: 'Sunset',     value: 'linear-gradient(135deg, #ff7e5f, #feb47b)',          preview: 'linear-gradient(135deg, #ff7e5f, #feb47b)' },
  { label: 'Forest',     value: 'linear-gradient(135deg, #134e5e, #71b280)',          preview: 'linear-gradient(135deg, #134e5e, #71b280)' },
];

type Tab = 'courses' | 'assignments';

function formatDue(dueDateStr: string | null): { text: string; color: string } {
  if (!dueDateStr) return { text: 'No due date', color: '#666' };
  const now = new Date();
  const due = new Date(dueDateStr);
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / 86400000);
  if (diffDays < 0)  return { text: 'Overdue',        color: '#ff5555' };
  if (diffDays === 0) return { text: 'Due today',      color: '#ff9900' };
  if (diffDays === 1) return { text: 'Due tomorrow',   color: '#ffcc00' };
  if (diffDays <= 7)  return { text: `Due in ${diffDays} days`, color: '#ffd966' };
  return {
    text: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    color: '#888',
  };
}

export default function App() {
  const [tab, setTab] = useState<Tab>('courses');
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [background, setBackground] = useState('');
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);

  useEffect(() => {
    getCurrentCourses()
      .then((items) => { setEnrollments(items); setCoursesLoading(false); })
      .catch((err)  => { setCoursesError(err.message); setCoursesLoading(false); });

    chrome.storage.sync.get('background', (result) => {
      if (result.background) setBackground(result.background as string);
    });
  }, []);

  useEffect(() => {
    if (tab !== 'assignments' || assignments !== null || assignmentsLoading || enrollments.length === 0) return;
    setAssignmentsLoading(true);
    getAllAssignments(enrollments)
      .then((items) => { setAssignments(items); setAssignmentsLoading(false); })
      .catch((err)  => { setAssignmentsError(err.message); setAssignmentsLoading(false); });
  }, [tab, enrollments, assignments, assignmentsLoading]);

  function chooseBackground(value: string) {
    setBackground(value);
    chrome.storage.sync.set({ background: value });
  }

  return (
    <div style={{
      padding: '14px 16px',
      minWidth: '380px',
      fontFamily: 'system-ui, sans-serif',
      background: '#141414',
      color: '#ddd',
      minHeight: '200px',
    }}>
      {/* Header */}
      <h2 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: '#b3a369', letterSpacing: '0.3px' }}>
        Better Brightspace
      </h2>

      {/* Background pickers */}
      <div style={{ marginBottom: '14px' }}>
        <p style={{ margin: '0 0 6px', fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
          Background
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {PRESETS.map((preset) => {
            const active = background === preset.value;
            return (
              <button
                key={preset.label}
                onClick={() => chooseBackground(preset.value)}
                style={{
                  padding: '5px 10px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  border: active ? '2px solid #b3a369' : '1px solid #444',
                  borderRadius: '5px',
                  background: preset.preview,
                  color: preset.value === '' ? '#333' : '#fff',
                  textShadow: preset.value === '' ? 'none' : '0 1px 3px rgba(0,0,0,0.7)',
                  fontWeight: active ? 700 : 500,
                  outline: 'none',
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #2a2a2a', marginBottom: '10px' }}>
        {(['courses', 'assignments'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '6px 14px',
              fontSize: '12px',
              cursor: 'pointer',
              border: 'none',
              borderBottom: tab === t ? '2px solid #b3a369' : '2px solid transparent',
              marginBottom: '-1px',
              background: 'none',
              color: tab === t ? '#b3a369' : '#666',
              fontWeight: tab === t ? 700 : 400,
              textTransform: 'capitalize',
              outline: 'none',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Courses tab */}
      {tab === 'courses' && (
        <div>
          {coursesLoading && <p style={msgStyle}>Loading courses…</p>}
          {coursesError  && <p style={{ ...msgStyle, color: '#ff5555' }}>Error: {coursesError}</p>}
          {!coursesLoading && !coursesError && enrollments.length === 0 && (
            <p style={msgStyle}>No current courses found.</p>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {enrollments.map((e) => (
              <li key={e.OrgUnit.Id} style={courseRowStyle}>
                {e.OrgUnit.Name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Assignments tab */}
      {tab === 'assignments' && (
        <div>
          {(coursesLoading || assignmentsLoading) && <p style={msgStyle}>Loading assignments…</p>}
          {assignmentsError && <p style={{ ...msgStyle, color: '#ff5555' }}>Error: {assignmentsError}</p>}
          {!assignmentsLoading && assignments && assignments.length === 0 && (
            <p style={msgStyle}>No assignments found.</p>
          )}
          {assignments && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {assignments.map((a) => {
                const { text, color } = formatDue(a.DueDate);
                return (
                  <li key={`${a.orgUnitId}-${a.Id}`} style={{ padding: '8px 0', borderBottom: '1px solid #222' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#ddd' }}>{a.Name}</div>
                    <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>{a.courseName}</div>
                    <div style={{ fontSize: '11px', color, marginTop: '2px', fontWeight: 500 }}>{text}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const msgStyle: React.CSSProperties = { fontSize: '13px', color: '#666', margin: '6px 0' };
const courseRowStyle: React.CSSProperties = { padding: '8px 0', borderBottom: '1px solid #222', fontSize: '13px', color: '#ccc' };
