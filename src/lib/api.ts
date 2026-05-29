const BASE = 'https://brightspace.vanderbilt.edu/d2l/api';

export type Enrollment = {
  OrgUnit: {
    Id: number;
    Name: string;
    Code: string | null;
  };
};

export type Assignment = {
  Id: number;
  Name: string;
  DueDate: string | null;
  courseName: string;
  orgUnitId: number;
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
  if (!res.ok) throw new Error(`Brightspace API error: ${res.status}`);
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
    if (!code.includes(term)) return false;
    if (name === code) return false;
    return true;
  });
}

async function getDropboxFolders(orgUnitId: number): Promise<{ Id: number; Name: string; DueDate: string | null }[]> {
  const res = await fetch(`${BASE}/le/1.71/${orgUnitId}/dropbox/folders/`, {
    credentials: 'include',
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getAllAssignments(enrollments: Enrollment[]): Promise<Assignment[]> {
  const results = await Promise.all(
    enrollments.map(async (e) => {
      const folders = await getDropboxFolders(e.OrgUnit.Id);
      return folders.map((f) => ({
        Id: f.Id,
        Name: f.Name,
        DueDate: f.DueDate,
        courseName: e.OrgUnit.Name,
        orgUnitId: e.OrgUnit.Id,
      }));
    })
  );
  return results.flat().sort((a, b) => {
    if (!a.DueDate) return 1;
    if (!b.DueDate) return -1;
    return new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime();
  });
}
