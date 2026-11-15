import type { JobActionKey, ProviderFunctionName } from '../api';

// ---- Package 3.4: workspace actions (Evaluate, Draft CV, Draft cover letter, Draft both).
// Shown only when the session reports taskDispatch. Nothing starts on load or navigation, and the
// score is never part of the bar or the dialog: the server decides which actions are enabled.

export const actionButtons: {
  key: JobActionKey;
  label: string;
  title: string;
  functions: ProviderFunctionName[];
}[] = [
  {
    key: 'evaluate',
    label: 'Evaluate',
    title: 'Evaluate this job',
    functions: ['evaluation', 'companyResearch'],
  },
  { key: 'cv', label: 'Draft CV', title: 'Draft a CV', functions: ['cv'] },
  {
    key: 'letter',
    label: 'Draft cover letter',
    title: 'Draft a cover letter',
    functions: ['coverLetter'],
  },
  {
    key: 'both',
    label: 'Draft both',
    title: 'Draft a CV and a cover letter',
    functions: ['cv', 'coverLetter'],
  },
];
