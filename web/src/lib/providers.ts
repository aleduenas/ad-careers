import type { ProviderFunctionName, ProviderKey, ReadinessState } from '../api';

// ---- Package 3.7: Providers page (subscription provider and model per LLM function).
// Never asks for a password or token: logins happen locally through the provider's own CLI.

export const providerLabels: Record<ProviderKey, string> = { claude: 'Claude', codex: 'OpenAI' };

export const loginCommands: Record<ProviderKey, string> = {
  claude: 'claude auth login',
  codex: 'codex login',
};

export const functionRows: { key: ProviderFunctionName; label: string; hint: string }[] = [
  { key: 'evaluation', label: 'Evaluation', hint: 'Scores a job against the rubric.' },
  {
    key: 'companyResearch',
    label: 'Company research',
    hint: 'Looks up the company during evaluation.',
  },
  { key: 'cv', label: 'CV', hint: 'Drafts a tailored CV.' },
  { key: 'coverLetter', label: 'Cover letter', hint: 'Drafts a cover letter.' },
];

export const readinessText: Record<ReadinessState, string> = {
  ready: 'Ready',
  notLoggedIn: 'Not logged in',
  unavailable: 'Unavailable',
  unknown: 'Not checked yet',
};
