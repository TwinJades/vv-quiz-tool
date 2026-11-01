import {dispatchValueEvents} from './dom-utils';
import {isZhidaoChoice,zhidaoSelected} from './zhidao-practice';
import {semanticOptionType} from './semantic-dom-mapping';

export interface TargetIdentity {
  role:'option'|'blank'|'submit'|'session_submit'|'next'|'retry'|'candidate';
  question_fingerprint:string;input_name:string;input_value:string;text_digest:string;
}
export type DomTarget=
  | {kind:'element';element:HTMLElement;identity:TargetIdentity}
  | {kind:'select_option';element:HTMLSelectElement;value:string;identity:TargetIdentity};

export function setDomSelected(target:DomTarget,value:boolean,supported:(element:Element)=>boolean,selected:(element:HTMLElement)=>boolean):void {
  if(!supported(target.element))throw new Error('Target is disabled.');
  if(target.kind==='select_option'){
    if(value&&target.element.value!==target.value){target.element.value=target.value;dispatchValueEvents(target.element);}return;
  }
  const element=target.element;
  if(isZhidaoChoice(element)){if(value&&!zhidaoSelected(element))element.click();return;}
  if(element.tagName==='INPUT'&&['radio','checkbox'].includes((element as HTMLInputElement).type)){
    const input=element as HTMLInputElement;if(input.disabled)throw new Error('Target is disabled.');if(input.checked!==value)input.click();return;
  }
  if(semanticOptionType(element)==='single_choice'&&!value)return;
  if(selected(element)!==value)element.click();
}
export function setDomValue(target:DomTarget,value:string):void {
  if(target.kind!=='element')throw new Error('Text target is invalid.');
  const element=target.element;
  if(element.tagName==='INPUT'||element.tagName==='TEXTAREA'){
    const input=element as HTMLInputElement|HTMLTextAreaElement;if(input.disabled||input.readOnly)throw new Error('Target is not editable.');input.focus();
    const prototype=input.tagName==='TEXTAREA'?input.ownerDocument.defaultView!.HTMLTextAreaElement.prototype:input.ownerDocument.defaultView!.HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(prototype,'value')?.set;if(!setter)throw new Error('TARGET_UNAVAILABLE: native input setter is unavailable.');
    setter.call(input,value);dispatchValueEvents(input);return;
  }
  if(!element.isContentEditable)throw new Error('Target is not a supported text field.');
  element.focus();element.textContent=value;dispatchValueEvents(element);
}
