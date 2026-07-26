import { VisitStatus } from './types';

export const STATUS_COLORS = {
  [VisitStatus.TODO]: 'bg-slate-400',
  [VisitStatus.VISITED]: 'bg-emerald-500',
  [VisitStatus.REVISIT]: 'bg-amber-400',
  [VisitStatus.NOT_INTERESTED]: 'bg-red-500',
};

export const STATUS_LABELS = {
  [VisitStatus.TODO]: 'To Do',
  [VisitStatus.VISITED]: 'Visited',
  [VisitStatus.REVISIT]: 'Re-visit',
  [VisitStatus.NOT_INTERESTED]: 'Not Interested',
};