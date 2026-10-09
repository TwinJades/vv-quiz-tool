export async function readH5pSingleChoiceResult(tabId: number): Promise<string | null> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) return null;
  const url = new URL(tab.url);
  if (url.origin !== "https://h5p.org" || !/^\/h5p\/embed\/\d+$/.test(url.pathname)) return null;
  const [reading] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const visible = (element: Element): boolean => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return bounds.width > 0 && bounds.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const body = document.body.innerText;
      const slide = body.match(/^Slide (\d+) of (\d+)$/m);
      const feedback = [...document.querySelectorAll(".h5p-question-feedback-content-text")]
        .filter(visible).find(element => /^You got \d+ of \d+ correct$/.test((element as HTMLElement).innerText.trim()));
      const correct = (feedback as HTMLElement | undefined)?.innerText.trim().match(/^You got (\d+) of (\d+) correct$/);
      const score = [...body.matchAll(/^You got (\d+) out of (\d+) points$/gm)]
        .find(match => match[1] === correct?.[1] && match[2] === correct?.[2]);
      if (!slide || slide[1] !== slide[2] || !score || !correct) return null;
      if (!document.querySelector(".h5p-sc-sound-control")) return null;
      if ([...document.querySelectorAll("input,textarea")].some(visible)) return null;
      if ([...document.querySelectorAll("button")].some(element =>
        visible(element) && element.className.includes("h5p-sc-") &&
        !element.className.includes("h5p-sc-sound-control"))) return null;
      return `${score[1]}/${score[2]}`;
    },
  });
  return reading?.result ?? null;
}
