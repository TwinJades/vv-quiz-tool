const reviewedPaths = new Set([
  "/form-library/examples/make-quiz-javascript/reactjs",
  "/form-library/examples/create-quiz-with-immediate-results/reactjs",
]);

export async function readSurveyJsResult(tabId: number): Promise<string | null> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) return null;
  const url = new URL(tab.url);
  if (url.origin !== "https://surveyjs.io" || !reviewedPaths.has(url.pathname)) return null;
  const [reading] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const result = document.querySelector<HTMLElement>(".sd-body.sd-completedpage");
      if (!result) return null;
      const style = getComputedStyle(result);
      const bounds = result.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0 || style.display === "none" || style.visibility === "hidden") return null;
      if (document.querySelector(".sd-timer")) return null;
      if ([...result.querySelectorAll("input,textarea,select")].some(element => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })) return null;
      return result.innerText.trim() || null;
    },
  });
  return reading?.result ?? null;
}
