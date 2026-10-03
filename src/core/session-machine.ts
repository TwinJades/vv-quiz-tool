export const sessionStates = [
  "CREATED",
  "QUEUED",
  "WAIT_READY",
  "OBSERVE_SESSION",
  "VALIDATE_OBSERVATION",
  "PARSE_SESSION",
  "BUILD_BATCH",
  "SOLVE",
  "VALIDATE_ANSWER",
  "ACT",
  "VERIFY",
  "REPLAN",
  "ADVANCE",
  "CLOSE_OUT",
  "PAUSED",
  "COMPLETE",
  "CANCELLED",
  "FAILED",
] as const;

export type SessionState = (typeof sessionStates)[number];

const transitions: Readonly<Record<SessionState, readonly SessionState[]>> = {
  CREATED: ["QUEUED", "WAIT_READY", "CANCELLED"],
  QUEUED: ["WAIT_READY", "PAUSED", "CANCELLED", "FAILED"],
  WAIT_READY: ["OBSERVE_SESSION", "PAUSED", "CANCELLED", "FAILED"],
  OBSERVE_SESSION: ["VALIDATE_OBSERVATION", "PAUSED", "CANCELLED", "FAILED"],
  VALIDATE_OBSERVATION: ["PARSE_SESSION", "OBSERVE_SESSION", "PAUSED", "CANCELLED", "FAILED"],
  PARSE_SESSION: ["BUILD_BATCH", "OBSERVE_SESSION", "PAUSED", "CANCELLED", "FAILED"],
  BUILD_BATCH: ["SOLVE", "COMPLETE", "CLOSE_OUT", "PAUSED", "CANCELLED", "FAILED"],
  SOLVE: ["VALIDATE_ANSWER", "PAUSED", "CANCELLED", "FAILED"],
  VALIDATE_ANSWER: ["ACT", "REPLAN", "OBSERVE_SESSION", "PAUSED", "CANCELLED", "FAILED"],
  ACT: ["VERIFY", "OBSERVE_SESSION", "PAUSED", "CANCELLED", "FAILED"],
  VERIFY: ["ADVANCE", "REPLAN", "OBSERVE_SESSION", "CLOSE_OUT", "PAUSED", "COMPLETE", "CANCELLED", "FAILED"],
  REPLAN: ["SOLVE", "PAUSED", "CLOSE_OUT", "CANCELLED", "FAILED"],
  ADVANCE: ["OBSERVE_SESSION", "COMPLETE", "CLOSE_OUT", "PAUSED", "CANCELLED", "FAILED"],
  CLOSE_OUT: ["ACT", "VERIFY", "COMPLETE", "PAUSED", "CANCELLED", "FAILED"],
  PAUSED: ["QUEUED", "WAIT_READY", "CANCELLED"],
  COMPLETE: [],
  CANCELLED: [],
  FAILED: [],
};

export class InvalidSessionTransitionError extends Error {
  constructor(readonly from: SessionState, readonly to: SessionState) {
    super(`Invalid session transition: ${from} -> ${to}`);
    this.name = "InvalidSessionTransitionError";
  }
}

export function transitionSession(from: SessionState, to: SessionState): SessionState {
  if (!transitions[from].includes(to)) {
    throw new InvalidSessionTransitionError(from, to);
  }
  return to;
}

export function shouldEnterCloseOut(remainingSeconds: number | null, thresholdSeconds = 60): boolean {
  return remainingSeconds !== null && remainingSeconds <= thresholdSeconds;
}
