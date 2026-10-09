import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";
import type { Folder, ScanEvent } from "./types";
export const isAndroid = Capacitor.getPlatform() === "android";
interface ScannerPlugin {
  addListener(
    name: "scanProgress",
    cb: (e: ScanEvent) => void,
  ): Promise<PluginListenerHandle>;
  startScan(options: {
    scanId: string;
    category?: string;
    treeUri?: string;
    scope: string;
    reselect?: boolean;
  }): Promise<void>;
  cancelScan(options: { scanId: string }): Promise<void>;
  chooseFolder(): Promise<Folder>;
  listFolders(): Promise<{ folders: Folder[] }>;
  forgetFolder(options: { uri: string }): Promise<void>;
  openFile(options: { uri: string; mime: string }): Promise<void>;
  thumbnail(options: { uri: string }): Promise<{ data: string }>;
  storageInfo(): Promise<{ total: number; available: number }>;
  openSettings(): Promise<void>;
}
export const Scanner = registerPlugin<ScannerPlugin>("PocketScanner");
