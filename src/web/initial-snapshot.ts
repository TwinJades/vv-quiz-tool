/** Read-only initial recognition input; IDs are temporary, never selectors. */
export interface InitialSemanticSnapshot {
  rendered_text_required?:boolean;
  chaoxing_question_ids?:string[];
  visible_text: string;
  regions: Array<{ region_id: string; text: string; controls: Array<{ role: string; text: string; disabled: boolean }> }>;
  elements?: SemanticElement[];
}

export interface InitialSemanticReading {
  region_ids: string[];
  questions?: SemanticQuestion[] | undefined;
  use_visual?: boolean | undefined;
}

export interface SemanticElement {
  element_id: string;
  parent_id: string | null;
  tag: string;
  text: string;
  classes: string[];
  role: string | null;
  input_type: string | null;
  clickable: boolean;
  disabled: boolean;
  selected: boolean;
}

export interface SemanticQuestion {
  region_id: string;
  type: 'single_choice' | 'multiple_choice' | 'fill_blank';
  stem_ids: string[];
  option_ids: string[];
  blank_ids: string[];
  controls: Array<{ element_id: string; role: 'submit' | 'session_submit' | 'next' | 'retry' }>;
}
