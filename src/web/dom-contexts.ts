import {isElementType} from './dom-utils';

export function collectContexts(document:Document):ParentNode[]{
  const contexts:ParentNode[]=[document],queue:ParentNode[]=[document];let visited=0;
  while(queue.length&&visited<10000&&contexts.length<64){
    const context=queue.shift()!;
    for(const element of Array.from(context.querySelectorAll<HTMLElement>('*'))){
      visited++;
      if(element.shadowRoot){contexts.push(element.shadowRoot);queue.push(element.shadowRoot);}
      if(isElementType(element,'iframe')&&element.contentDocument){contexts.push(element.contentDocument);queue.push(element.contentDocument);}
      if(visited>=10000)break;
    }
  }
  return contexts;
}
export function queryAllDeep<T extends Element>(document:Document,selector:string):T[]{return collectContexts(document).flatMap(context=>Array.from(context.querySelectorAll<T>(selector)));}
