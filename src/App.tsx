import { useEffect, useState } from 'react';
import { getEnrollments, type Enrollment } from './lib/api';
import './App.css';

function App() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getEnrollments()
      .then((items) => {
        setEnrollments(items);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <div style={{ padding: '16px', minWidth: '350px', fontFamily: 'sans-serif' }}>
      <h2 style={{ marginTop: 0 }}>Better Brightspace</h2>
      {loading && <p>Loading your courses...</p>}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      {!loading && !error && (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {enrollments.map((e) => (
            <li
              key={e.OrgUnit.Id}
              style={{ padding: '4px 0', borderBottom: '1px solid #eee' }}
            >
              <strong>{e.OrgUnit.Code}</strong>
              <br />
              <span style={{ fontSize: '12px', color: '#666' }}>{e.OrgUnit.Name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default App;