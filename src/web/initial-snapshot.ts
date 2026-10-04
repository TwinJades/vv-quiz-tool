/** Read-only initial recognition input; IDs are temporary, never selectors. */
export interface InitialSemanticSnapshot {
  visible_text: string;
  regions: Array<{ region_id: string; text: string; controls: Array<{ role: string; text: string; disabled: boolean }> }>;
}

export interface InitialSemanticReading {
  region_ids: string[];
}
