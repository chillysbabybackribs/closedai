import { parseNativePdfTree } from './accessibility-text.js'

/** Runs only in app-created chrome://accessibility, never in document content.
 * requestWebContentsTree owns a scoped accessibility mode in its WebUI handler;
 * destroying the helper releases it. No global flags or clipboard operations.
 */
export function nativePdfReadScript(processId: number, url: string, page: number, maxChars: number): string {
  return `(async () => {
    const parse = ${parseNativePdfTree.toString()};
    const processId = ${processId};
    // WebUI identifies RenderViews, while Electron exposes RenderFrame routing ids.
    // Match a unique live target; never guess a routing-id offset.
    const request = new XMLHttpRequest();
    request.open('GET', 'targets-data.json', false);
    request.send(null);
    const candidates = JSON.parse(request.responseText).pages.filter(
      target => target.processId === processId && target.url === ${JSON.stringify(url)}
    );
    if (candidates.length !== 1) throw new Error('Native PDF target is missing or ambiguous');
    const routingId = candidates[0].routingId;
    const cr = await import('chrome://resources/js/cr.js');
    let latest = null;
    for (let attempt = 0; attempt < 35; attempt++) {
      const result = await new Promise((resolve, reject) => {
        let listener;
        const timer = setTimeout(() => {
          cr.removeWebUiListener(listener);
          reject(new Error('Chromium PDF accessibility request timed out'));
        }, 1500);
        listener = cr.addWebUiListener('showOrRefreshTree', data => {
          if (data.processId !== processId || data.routingId !== routingId) return;
          clearTimeout(timer);
          cr.removeWebUiListener(listener);
          if (data.error) { reject(new Error(String(data.error))); return; }
          if (typeof data.tree !== 'string' || data.tree.length > 8000000) {
            reject(new Error('Chromium PDF accessibility tree is missing or exceeds 8 million characters'));
            return;
          }
          resolve(parse(data.tree, ${page}, ${maxChars}));
        });
        chrome.send('requestWebContentsTree', [{
          processId, routingId, requestType: 'showOrRefreshTree',
          filters: { allow: 'name', allowEmpty: '', deny: '' }
        }]);
      });
      latest = result;
      if (result.available) return result;
      if (result.totalPages && ${page} > result.totalPages) return result;
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    return latest;
  })()`
}
