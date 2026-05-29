const BASE = 'https://brightspace.vanderbilt.edu/d2l/api';

export type Enrollment = {
  OrgUnit: {
    Id: number;
    Name: string;
    Code: string;
  };
};

export async function getEnrollments(): Promise<Enrollment[]> {
  const res = await fetch(`${BASE}/lp/1.60/enrollments/myenrollments/`, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`Brightspace API error: ${res.status}`);
  }
  const data = await res.json();
  return data.Items;
}