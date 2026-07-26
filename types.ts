export enum VisitStatus {
  TODO = 'TODO',
  VISITED = 'VISITED',
  REVISIT = 'REVISIT',
  NOT_INTERESTED = 'NOT_INTERESTED'
}

export interface Note {
  text: string;
  date: string;
}

export interface House {
  id: string; 
  address: string;
  street: string;
  owner: string;
  lat: number;
  lng: number;
  status: VisitStatus;
  notes: Note[];
  lastUpdated?: number; 
  zip?: string;
}

export interface RegistryEntry {
  area: string;
  zip: string;
  link: string;
}

export interface ProgressState {
  status: VisitStatus;
  notes: Note[];
  lastUpdated: number;
}