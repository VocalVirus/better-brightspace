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

let _userId: string | null = null;

async function getUserId(): Promise<string> {
  if (_userId) return _userId;
  const res = await fetch(`${BASE}/lp/1.60/users/whoami`, { credentials: 'include' });
  if (!res.ok) throw new Error(`whoami failed: ${res.status}`);
  const data = await res.json();
  _userId = String(data.Identifier);
  return _userId;
}

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

export type BrightspaceGradeItem = {
  id: string;
  name: string;
  pointsEarned: number;
  pointsPossible: number;
  pct: number;
};

export async function getCourseGradeItems(orgUnitId: number): Promise<BrightspaceGradeItem[]> {
  const userId = await getUserId();
  const res = await fetch(`${BASE}/le/1.71/${orgUnitId}/grades/values/${userId}/`, {
    credentials: 'include',
  });
  if (!res.ok) return [];
  const data = await res.json();
  const raw: any[] = Array.isArray(data) ? data : (data.Objects ?? []);
  return raw
    .filter((item) => item.GradeObjectType === 1 && item.PointsNumerator != null && item.PointsDenominator > 0)
    .map((item) => ({
      id: String(item.GradeObjectIdentifier),
      name: item.GradeObjectName as string,
      pointsEarned: item.PointsNumerator as number,
      pointsPossible: item.PointsDenominator as number,
      pct: (item.PointsNumerator / item.PointsDenominator) * 100,
    }));
}

type FinalGradeValue = {
  PointsNumerator: number | null;
  PointsDenominator: number | null;
  WeightedNumerator: number | null;
  WeightedDenominator: number | null;
  DisplayedGrade: string | null;
};

export async function getCourseGrade(orgUnitId: number): Promise<number | null> {
  const userId = await getUserId();
  const res = await fetch(`${BASE}/le/1.71/${orgUnitId}/grades/final/values/${userId}/`, {
    credentials: 'include',
  });
  if (!res.ok) return null;
  const data: FinalGradeValue = await res.json();
  if (data.PointsNumerator != null && data.PointsDenominator != null && data.PointsDenominator > 0) {
    return (data.PointsNumerator / data.PointsDenominator) * 100;
  }
  if (data.WeightedNumerator != null && data.WeightedDenominator != null && data.WeightedDenominator > 0) {
    return (data.WeightedNumerator / data.WeightedDenominator) * 100;
  }
  if (data.DisplayedGrade) {
    const match = data.DisplayedGrade.match(/(\d+\.?\d*)/);
    if (match) return parseFloat(match[1]);
  }
  return null;
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
