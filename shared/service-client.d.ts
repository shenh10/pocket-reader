import type { ContentStatus } from "./content-client.js";
export function setServiceBase(value: string): string;
export function serviceBase(): Promise<string>;
export function readService<T = any>(
  route: string,
  options?: { onStatus?: (status: ContentStatus) => void },
): Promise<T>;
