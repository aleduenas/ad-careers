import type { JobItem } from '../api';

type Confidence = NonNullable<JobItem['yoeConfidence']>;

/** The compact estimate shown on a row: "3+ yrs". */
export const yoeLabel = (years: number) => `${years}+ yrs`;

const confidenceText: Record<Confidence, string> = {
  high: 'high confidence',
  medium: 'medium confidence',
  low: 'low confidence',
  inferred: 'guessed from the title',
};

export const yoeConfidenceText = (confidence: JobItem['yoeConfidence']) =>
  confidence ? confidenceText[confidence] : '';

/** Low and inferred estimates get a quiet mark next to the number. */
export const yoeIsUncertain = (confidence: JobItem['yoeConfidence']) =>
  confidence === 'low' || confidence === 'inferred';
