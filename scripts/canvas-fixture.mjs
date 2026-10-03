import { inflateSync } from "node:zlib";

// Local protocol fixture: the mock reader decodes markers in actual screenshot
// pixels. It never reads page variables or receives the solver's planned answer.
export function canvasFixtureHtml(kind, closed = false) {
  if (!["single", "multi", "fill"].includes(kind)) throw new Error("Unknown canvas fixture");
  return `<!doctype html><title>VV actual canvas ${kind}</title><style>canvas:focus{outline:none}</style>${closed ? '<nav><button id="menu">Menu</button></nav><closed-quiz style="display:block;width:300px;height:180px"></closed-quiz>' : '<canvas width="300" height="180" tabindex="0"></canvas>'}<script>
    ${closed ? `const shadow=document.querySelector('closed-quiz').attachShadow({mode:'closed'});shadow.innerHTML='<style>canvas:focus{outline:none}</style><canvas width="300" height="180" tabindex="0"></canvas>';` : ""}
    const canvas=${closed ? "shadow" : "document"}.querySelector('canvas'),ctx=canvas.getContext('2d');
    window.canvasBounds=()=>canvas.getBoundingClientRect().toJSON();
    window.canvasState={kind:${JSON.stringify(kind)},selected:null,multi:{a:false,b:false},focused:false,text:'',selectAll:false,completed:false,events:[]};
    function draw(){const s=canvasState;ctx.fillStyle='white';ctx.fillRect(0,0,300,180);ctx.fillStyle='black';ctx.font='18px sans-serif';
      if(s.completed){ctx.fillText('Final score '+(s.kind==='multi'?'2/2':'1/1'),20,70)}else{
        ctx.fillText(s.kind==='multi'?'Select Alpha and Beta':s.kind==='fill'?'Type Alpha':'Choose Alpha',20,30);
        if(s.kind==='fill'){ctx.strokeStyle=s.focused?'blue':'black';ctx.strokeRect(20,50,260,40);ctx.fillText('Answer: '+s.text,30,78)}else{
          ctx.strokeStyle='black';ctx.strokeRect(20,50,110,40);ctx.fillText((s.kind==='multi'?s.multi.a:s.selected==='a')?'✓ Alpha':'Alpha',30,78);
          ctx.strokeRect(150,50,130,40);ctx.fillText((s.kind==='multi'?s.multi.b:s.selected==='b')?'✓ Beta':'Beta',160,78)}
        ctx.strokeStyle='black';ctx.strokeRect(20,120,130,35);ctx.fillText('Submit quiz',25,145)}
      const mask=s.kind==='fill'?Number(s.focused):s.kind==='multi'?Number(s.multi.a)+2*Number(s.multi.b):s.selected==='a'?1:s.selected==='b'?2:0;
      ctx.fillStyle='rgb('+(s.kind==='single'?10:s.kind==='multi'?20:30)+','+mask+','+(s.completed?255:0)+')';ctx.fillRect(0,0,1,1);
      for(let i=0;i<s.text.length;i++){ctx.fillStyle='rgb('+s.text.charCodeAt(i)+',0,0)';ctx.fillRect(i+1,0,1,1)}ctx.fillStyle='black';ctx.fillRect(s.text.length+1,0,1,1);}
    canvas.addEventListener('pointerdown',event=>{const s=canvasState;s.events.push({type:'pointer',trusted:event.isTrusted,timestamp:event.timeStamp+performance.timeOrigin,x:event.offsetX,y:event.offsetY});
      if(!event.isTrusted)return;canvas.focus();if(event.offsetY>=50&&event.offsetY<100){if(s.kind==='fill')s.focused=true;
        else if(s.kind==='multi'){const id=event.offsetX<140?'a':'b';s.multi[id]=!s.multi[id]}else s.selected=event.offsetX<140?'a':'b';}
      if(event.offsetY>=120)s.completed=s.kind==='fill'?s.text==='Alpha':s.kind==='multi'?s.multi.a&&s.multi.b:s.selected==='a';draw()});
    canvas.addEventListener('keydown',event=>{const s=canvasState;s.events.push({type:'keyboard',trusted:event.isTrusted,timestamp:event.timeStamp+performance.timeOrigin});
      if(!event.isTrusted||s.kind!=='fill'||!s.focused)return;event.preventDefault();
      if(event.ctrlKey&&event.key.toLowerCase()==='a')s.selectAll=true;else if(event.key==='Backspace'){s.text=s.selectAll?'':s.text.slice(0,-1);s.selectAll=false}
      else if(event.key.length===1&&!event.ctrlKey&&!event.altKey){s.text=(s.selectAll?'':s.text)+event.key;s.selectAll=false}draw()});draw();</script>`;
}

export function readingFromScreenshot(body, metadata) {
  const imageUrl = body.messages.find(message => message.role === "user").content.find(part => part.type === "image_url").image_url.url;
  const png = Buffer.from(imageUrl.split(",")[1], "base64");
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const bpp = png[25] === 6 ? 4 : png[25] === 2 ? 3 : 0;
  if (!bpp) throw new Error("Unexpected screenshot PNG color type");
  const decoded = inflateSync(Buffer.concat(chunks));
  const imageWidth = png.readUInt32BE(16), imageHeight = png.readUInt32BE(20), stride = imageWidth * bpp;
  const paeth = (a,b,c) => { const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c; };
  let previous = new Uint8Array(stride), row, originX=0, originY=0;
  for (let y=0;y<imageHeight;y++) {
    const filter=decoded[y*(stride+1)];
    const candidate=Uint8Array.from(decoded.subarray(y*(stride+1)+1,(y+1)*(stride+1)));
    for(let i=0;i<stride;i++) {
      const left=i<bpp?0:candidate[i-bpp],up=previous[i],upperLeft=i<bpp?0:previous[i-bpp];
      const adjustment=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):filter===4?paeth(left,up,upperLeft):NaN;
      if(Number.isNaN(adjustment))throw new Error("Unsupported PNG row filter");
      candidate[i]=(candidate[i]+adjustment)&255;
    }
    for(let x=0;x<imageWidth;x++) {
      if([10,20,30].includes(candidate[x*bpp])&&candidate[x*bpp+1]<=3&&[0,255].includes(candidate[x*bpp+2])) {
        originX=x;originY=y;row=candidate.subarray(x*bpp);break;
      }
    }
    if(row)break;
    previous=candidate;
  }
  if(!row)throw new Error("No fixture pixel marker found");
  const kind = row[0] === 10 ? "single" : row[0] === 20 ? "multi" : row[0] === 30 ? "fill" : null;
  if (!kind) throw new Error(`Unknown pixel marker ${Array.from(row.subarray(0, 3))}`);
  const mask = row[1];
  const completed = row[2] === 255;
  let value = "";
  for (let x = 1; x <= 20 && row[x * bpp]; x++) value += String.fromCharCode(row[x * bpp]);
  const point = (x, y) => ({ x: (originX+x)*1000/imageWidth, y: (originY+y)*1000/imageHeight });
  const result = { coordinate_space: "normalized_1000", status: completed ? "completed" : "questions", confidence: 1,
    questions: completed ? [] : [{ type: kind === "fill" ? "fill_blank" : kind === "multi" ? "multiple_choice" : "single_choice",
      stem: kind === "fill" ? "Type Alpha" : kind === "multi" ? "Select Alpha and Beta" : "Choose Alpha",
      region: { ...point(0,0), width: 300*1000/imageWidth, height: 180*1000/imageHeight },
      options: kind === "fill" ? [] : [{ text: "Alpha", point: point(60, 70), selected: (mask & 1) !== 0, disabled: false, confidence: 1 },
        { text: "Beta", point: point(190, 70), selected: (mask & 2) !== 0, disabled: false, confidence: 1 }],
      blanks: kind !== "fill" ? [] : [{ text: "Answer", point: point(100, 70), value, required: true, focused: mask === 1, disabled: false, confidence: 1 }],
      min_selections: kind === "fill" ? 0 : kind === "multi" ? 2 : 1, max_selections: kind === "fill" ? 0 : kind === "multi" ? 2 : 1 }],
    controls: completed ? [] : [{ text: "Submit quiz", role: "session_submit", question_index: null, point: point(80, 140), disabled: false, confidence: 1 }],
    feedback: null, feedback_text: "", visible_score: completed ? kind === "multi" ? "2/2" : "1/1" : null, question_total: 1, timer_is_countdown: null, timer_remaining_seconds: null };
  return { result, evidence: { visual_frame_id: metadata.visual_frame_id, kind, mask, value, completed } };
}
