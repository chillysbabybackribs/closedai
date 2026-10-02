/** Relative paths always use forward slashes, including on Windows. */
export type FileTreeEntry = { name: string; path: string; directory: boolean; symlink: boolean }
export type FileTreeListing = { entries: FileTreeEntry[]; truncated: boolean }
