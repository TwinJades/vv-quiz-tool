export interface InteractionBinding {
  session_id: string;
  epoch: string;
  enabled: boolean;
}

export interface NativeInputTicket extends InteractionBinding {
  nonce: string;
  kind: "pointer" | "keyboard";
  timestamp: number;
  expires_at: number;
  expected_text?: string;
}

export function assertInteractionActive(binding:InteractionBinding|null,signal:AbortSignal,sessionId?:string,epoch?:string):void {
  if(sessionId&&(!binding?.enabled||binding.session_id!==sessionId||binding.epoch!==epoch))throw new Error('USER_INTERACTION: execution belongs to an inactive session.');
  if(signal.aborted)throw new Error('USER_INTERACTION: execution was cancelled; observe the page before continuing.');
}

export class AutomationExecution {
  #depth=0;
  get depth():number{return this.#depth;}
  run<T>(operation:()=>T):T {
    this.#depth++;let asynchronous=false;
    try{const result=operation();if(result instanceof Promise){asynchronous=true;return result.finally(()=>{this.#depth--;}) as T;}return result;}
    finally{if(!asynchronous)this.#depth--;}
  }
}

// A page-local latch stops execution before the asynchronous background pause arrives.
export class InteractionGuard {
  #binding: InteractionBinding | null = null;
  #controller = new AbortController();
  #automation=new AutomationExecution();
  #nativeTicket: NativeInputTicket | null = null;
  #nativeCause: EventTarget | null = null;
  #derivedEvents = new Set<string>();
  #visualScope: VisualGeometry | null = null;
  readonly #listener=(event:Event)=>this.handle(event);

  constructor(
    private readonly document: Document,
    private readonly isQuizTarget: (target: EventTarget | null) => boolean,
    private readonly notify: (binding: InteractionBinding) => void,
  ) {
    for (const type of ["pointerdown", "keydown", "beforeinput", "input", "change"]) {
      document.addEventListener(type, this.#listener, { capture: true });
    }
  }
  dispose():void {
    this.#controller.abort();this.#binding=null;this.armNativeInput(null);this.#visualScope=null;
    for(const type of ['pointerdown','keydown','beforeinput','input','change'])this.document.removeEventListener(type,this.#listener,{capture:true});
  }

  configure(binding: InteractionBinding): boolean {
    const same = this.#binding?.session_id === binding.session_id && this.#binding.epoch === binding.epoch;
    // Delayed shutdown from an older run must not disable a resumed/new session.
    if (!binding.enabled && !same) return false;
    if (!same) {
      this.#visualScope = null;
      this.#controller.abort();
      this.#controller = new AbortController();
    }
    this.#binding = binding;
    if (!binding.enabled) { this.#controller.abort(); this.armNativeInput(null); this.#visualScope = null; }
    return true;
  }

  protectVisualScope(binding: InteractionBinding, geometry: VisualGeometry): void {
    this.signal(binding.session_id, binding.epoch);
    this.#visualScope = structuredClone(geometry);
  }

  #visualInteraction(event: { clientX?: number; clientY?: number }, path: Array<EventTarget | null>): boolean {
    const scope = this.#visualScope;
    const view = this.document.defaultView;
    if (!scope || !view || scope.url !== view.location.href || scope.time_origin !== view.performance.timeOrigin) return false;
    const ElementClass = view.Element;
    const elements = path.filter((target): target is Element => target instanceof ElementClass);
    if (elements.some(target => target.closest("header,nav,aside,footer,[role='search']"))) return false;
    // A changed viewport/scroll cannot authorize using old coordinates. Until
    // the next observation, manual input in the visible main surface pauses.
    const changed = scope.scroll.x !== view.scrollX || scope.scroll.y !== view.scrollY ||
      scope.viewport.width !== view.innerWidth || scope.viewport.height !== view.innerHeight ||
      scope.viewport.scale !== (view.visualViewport?.scale ?? 1);
    const region = changed ? { x: 0, y: 0, width: view.innerWidth, height: view.innerHeight } : scope.region;
    if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) return event.clientX! >= region.x && event.clientY! >= region.y &&
      event.clientX! < region.x + region.width && event.clientY! < region.y + region.height;
    // Closed shadow roots retarget keys/inputs to their host. The host's bounds
    // can protect the visible quiz without inspecting or opening that root.
    return elements.some(target => {
      const rect = target.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.left < region.x + region.width && rect.right > region.x &&
        rect.top < region.y + region.height && rect.bottom > region.y;
    });
  }

  handle(event: Pick<Event, "isTrusted" | "target" | "type"> & { clientX?: number; clientY?: number; key?: string; timeStamp?: number; data?: string | null; inputType?: string; composedPath?: () => EventTarget[] }): void {
    if (!event.isTrusted || !this.#binding?.enabled || this.#controller.signal.aborted) return;
    const ticket = this.#nativeTicket;
    if (ticket && Date.now() <= ticket.expires_at) {
      if ((ticket.kind === "pointer" ? event.type === "pointerdown" : event.type === "keydown") &&
        Math.abs((event.timeStamp ?? -Infinity) + performance.timeOrigin - ticket.timestamp) < 2) {
        this.#nativeCause = event.target;
        return;
      }
      if (this.#nativeCause === event.target && !this.#derivedEvents.has(event.type) && ["beforeinput", "input", "change"].includes(event.type) &&
        (ticket.kind === "pointer" ? ["input", "change"].includes(event.type) :
          event.type === "change" || (ticket.expected_text === "" ? event.inputType === "deleteContentBackward" : event.inputType === "insertText" && event.data === ticket.expected_text))) {
        this.#derivedEvents.add(event.type);
        return;
      }
    }
    // Native radio .click() emits trusted input/change synchronously. Suppress only
    // that immediate effect; pointer/keyboard input is never suppressed.
    if (this.#automation.depth > 0 && ["input", "change"].includes(event.type)) return;
    if (event.type === "keydown" && ["Tab", "Shift", "Control", "Alt", "Meta", "Escape"].includes(event.key ?? "")) return;
    const path = event.composedPath?.() ?? [event.target];
    if (!path.some(target => this.isQuizTarget(target)) && !this.#visualInteraction(event, path)) return;
    this.#controller.abort();
    this.armNativeInput(null);
    this.notify(this.#binding);
  }

  armNativeInput(ticket: NativeInputTicket | null): void {
    if (ticket) this.signal(ticket.session_id, ticket.epoch);
    this.#nativeTicket = ticket;
    this.#nativeCause = null;
    this.#derivedEvents.clear();
  }

  runAutomation<T>(operation: () => T): T {
    return this.#automation.run(operation);
  }

  signal(sessionId?: string, epoch?: string): AbortSignal {
    assertInteractionActive(this.#binding,this.#controller.signal,sessionId,epoch);
    return this.#controller.signal;
  }

  matches(sessionId: string, epoch: string): boolean {
    return this.#binding?.session_id === sessionId && this.#binding.epoch === epoch;
  }
}
import type { VisualGeometry } from "../core/visual";
