export type Theme = 'light' | 'dark';

export function initialTheme(): Theme {
  try {
    return localStorage.getItem('career-ops-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
