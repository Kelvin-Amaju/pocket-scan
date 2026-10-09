export type Category = "photos" | "videos" | "audio" | "other";
export type Tab = "all" | "photos" | "videos" | "audio" | "folders";
export interface Entry {
  id: string;
  uri: string;
  name: string;
  mime: string;
  size: number;
  modified: number;
  folder: string;
  category: Category;
  scope: string;
  file?: File;
}
export interface Folder {
  uri: string;
  name: string;
}
export interface Snapshot {
  scope: string;
  items: Entry[];
  updated: number;
  limited?: boolean;
}
export interface ScanEvent {
  scanId: string;
  state: "batch" | "complete" | "cancelled" | "error";
  items?: Entry[];
  count: number;
  skipped?: number;
  limited?: boolean;
  message?: string;
}
