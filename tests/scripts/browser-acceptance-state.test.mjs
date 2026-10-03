import { describe, expect, it } from "vitest";
import { correlateTabs, updateInventory } from "../../scripts/browser-acceptance-state.mjs";

const url = "https://example.test/quiz";
const snapshot = (id, state = "PAUSED") => ({ session_id: id, state, model_id: "gemini-3.8-flash", progress: { answered: 0 }, model_calls: { used: 0 } });
const report = () => ({ tabs: [], sessions: [] });

describe("whole browser acceptance recorder", () => {
  it("links duplicate URLs by document identity, regardless of tab order", () => {
    const pages = [{ id: "a", url, time_origin: 100 }, { id: "b", url, time_origin: 200 }];
    const tabs = [{ id: 2, identity: { url, time_origin: 200 } }, { id: 1, identity: { url, time_origin: 100 } }];
    expect([...correlateTabs(pages, tabs)]).toEqual([[2, "b"], [1, "a"]]);
  });
  it("never guesses among duplicate URLs without identity", () => {
    expect(correlateTabs([{ id: "a", url }, { id: "b", url }], [{ id: 1, url }]).size).toBe(0);
  });
  it("rejects ambiguous identical document identities", () => {
    const identity = { url, time_origin: 100 };
    expect(correlateTabs([{ id: "a", ...identity }], [{ id: 1, identity }, { id: 2, identity }]).size).toBe(0);
  });
  it("discovers inaccessible tabs while linking an authorized session in another window", () => {
    const state = report();
    updateInventory(state, [{ id: "a", url }, { id: "b", url: "https://other.test/" }], [{ id: 1, url, window_id: 20, snapshot: snapshot("s1") }, { id: 2 }], "now");
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[0].window_id).toBe(20);
    expect(state.tabs[1].tab_id).toBeNull();
    expect(state.sessions[0].target_id).toBe("a");
  });
  it("retains navigation, reload and closed tab history", () => {
    const state = report();
    updateInventory(state, [{ id: "a", url, time_origin: 100 }], [], "1");
    updateInventory(state, [{ id: "a", url: url + "?q=2", time_origin: 200 }], [], "2");
    updateInventory(state, [{ id: "a", url: url + "?q=2", time_origin: 300 }], [], "3");
    const events = updateInventory(state, [], [], "4");
    expect(state.tabs[0].navigation_history.map(item => item.at)).toEqual(["1", "2", "3"]);
    expect(state.tabs[0].closed_at).toBe("4");
    expect(events[0].type).toBe("tab_closed");
  });
  it("keeps separate runs and their results after restarting VV in one tab", () => {
    const state = report();
    updateInventory(state, [{ id: "a", url }], [{ id: 1, url, snapshot: snapshot("s1", "COMPLETE") }], "1");
    state.sessions[0].website_result = { score_lines: ["3/3"] };
    const events = updateInventory(state, [{ id: "a", url }], [{ id: 1, url, snapshot: snapshot("s2") }], "2");
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions[0].website_result.score_lines).toEqual(["3/3"]);
    expect(state.tabs[0].latest_session_id).toBe("s2");
    expect(events.find(item => item.type === "vv_state").session_id).toBe("s2");
  });
  it("records an unlinked session and links it later without creating a duplicate run", () => {
    const state = report();
    updateInventory(state, [{ id: "a", url }], [{ id: 1, snapshot: snapshot("s1") }], "1");
    expect(state.sessions[0].target_id).toBeNull();
    updateInventory(state, [{ id: "a", url }], [{ id: 1, url, snapshot: snapshot("s1") }], "2");
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].target_id).toBe("a");
  });
});
