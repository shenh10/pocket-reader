export type ContentStatus = "online" | "cached";
export const contentCache: {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  clear(): Promise<void>;
};
export function cacheKey(url: string): string;
export function readContent<T = any>(
  url: string,
  options?: {
    validate?: (value: any) => boolean;
    timeout?: number;
    onStatus?: (status: ContentStatus) => void;
  },
): Promise<T>;
export function isManifest(value: any): boolean;
export function isDashboard(value: any): boolean;
