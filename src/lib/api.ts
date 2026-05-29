const BASE = 'https://brightspace.vanderbilt.edu/d2l/api';

export type Enrollment = {
  OrgUnit: {
    Id: number;
    Name: string;
    Code: string | null;
  };
};

function getCurrentTermCode(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  let season: string;

  if (month <= 4) season = 'S';
  else if (month <= 7) season = 'M';
  else season = 'F';

  return `${year}${season}`;
}

export async function getEnrollments(): Promise<Enrollment[]> {
  const res = await fetch(`${BASE}/lp/1.60/enrollments/myenrollments/`, {
    credentials: 'include',
  });

  if (!res.ok) {
    throw new Error(`Brightspace API error: ${res.status}`);
  }

  const data = await res.json();
  return data.Items as Enrollment[];
}

export async function getCurrentCourses(): Promise<Enrollment[]> {
  const all = await getEnrollments();
  const term = getCurrentTermCode();
  return all.filter((e) => {
    const code = e.OrgUnit.Code;
    const name = e.OrgUnit.Name;
    if (!code || !name) return false;
    // Must be in the current term
    if (!code.includes(term)) return false;
    // Real courses have a readable Name different from the Code;
    // section-enrollment junk (SEC_*) has Name === Code
    if (name === code) return false;
    return true;
  });
}