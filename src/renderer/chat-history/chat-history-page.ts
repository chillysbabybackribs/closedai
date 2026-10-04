/** Rows painted per page; a workspace can hold a thousand chats and painting them all was slow. */
export const HISTORY_PAGE_SIZE = 50

/** How many rows to show after asking for more: one more page, never past the end. */
export function nextHistoryPage(shown: number, total: number, pageSize = HISTORY_PAGE_SIZE): number {
  return Math.min(total, shown + pageSize)
}
