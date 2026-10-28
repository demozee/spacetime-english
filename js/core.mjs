// Word positions, rather than strings, identify progress.
export function wordsOf(text){return [...text.matchAll(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*|['’]\d+/g)].map(m=>({text:m[0],start:m.index,end:m.index+m[0].length}));}
const forms={"there's":'there is',"we're":'we are',"we'd":'we would',"we'll":'we will',"i'm":'i am',"i'll":'i will',"i've":'i have',"i'd":'i would',"you're":'you are',"you'll":'you will',"it's":'it is',"that's":'that is',"don't":'do not',"doesn't":'does not',"didn't":'did not',"can't":'can not',"won't":'will not',"where'd":'where did',"what's":'what is',"haven't":'have not',"isn't":'is not',"wasn't":'was not',gonna:'going to',wanna:'want to',"'65":'sixty five','65':'sixty five','2009':'two thousand nine'};
Object.assign(forms,{"shouldn't":'should not',"she'll":'she will',"he'll":'he will',"she's":'she is',"he's":'he is',"they're":'they are',"they'll":'they will',"aren't":'are not',"weren't":'were not',"couldn't":'could not',"wouldn't":'would not',"hasn't":'has not',"hadn't":'had not'});
Object.assign(forms,{"you've":'you have',"you'd":'you would',"we've":'we have',"they've":'they have',"they'd":'they would',"what'd":'what did',"how's":'how is',"backup's":'backup is',"body's":'body is'});
const units=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
for(let n=0;n<100;n++)forms[String(n)]=n<20?units[n]:`${tens[Math.floor(n/10)]}${n%10?' '+units[n%10]:''}`;
export function normalize(text){return wordsOf(text.toLowerCase().replaceAll('’',"'").replaceAll('%',' percent ')).flatMap(w=>(forms[w.text]||w.text).split(' '));}
export function targets(text){return wordsOf(text).map(w=>({...w,atoms:normalize(w.text)}));}
export function referenceText(text){return targets(text).flatMap(t=>t.atoms).join(' ');}
// Match remaining positions to transcription. No pronunciation scores are invented.
function matchRecognized(text,observed,already=[]){
  const ts=targets(text),remaining=ts.map((t,position)=>({...t,position})).filter(t=>!already.includes(t.position));
  const flat=remaining.flatMap(t=>t.atoms),pairs=alignWords(flat,observed);
  const matched=new Map(pairs),used=new Set(),passed=new Set(already);let offset=0;
  for(const t of remaining){
    if(t.atoms.every((_,j)=>matched.has(offset+j))){passed.add(t.position);t.atoms.forEach((_,j)=>used.add(matched.get(offset+j)));}
    offset+=t.atoms.length;
  }
  return {passed:[...passed].sort((a,b)=>a-b),unused:observed.filter((_,i)=>!used.has(i))};
}
export function recognizeWords(text,transcript,already=[]){return matchRecognized(text,normalize(transcript).slice(-600),already).passed;}
export class RecognitionProgress{
  constructor(text,already=[]){this.text=text;this.passed=[...already];this.finals=new Set();this.pending=[];}
  update(segments){
    for(const s of segments){
      if(!s.final||this.finals.has(s.id))continue;
      this.finals.add(s.id);
      const result=matchRecognized(this.text,[...this.pending,...normalize(s.text)].slice(-600),this.passed);
      this.passed=result.passed;
      // Retain only unfinished contraction fragments, not arbitrary old words.
      const incomplete=new Set(targets(this.text).filter((t,i)=>!this.passed.includes(i)&&t.atoms.length>1).flatMap(t=>t.atoms));
      this.pending=result.unused.filter(atom=>incomplete.has(atom)).slice(-20);
    }
    const interim=segments.filter(s=>!s.final).flatMap(s=>normalize(s.text));
    const preview=matchRecognized(this.text,[...this.pending,...interim].slice(-600),this.passed).passed.filter(i=>!this.passed.includes(i));
    return {passed:[...this.passed],preview,complete:this.passed.length===targets(this.text).length};
  }
}
export function alignWords(expected,observed){
  const dp=Array.from({length:expected.length+1},()=>new Uint16Array(observed.length+1));
  for(let i=expected.length-1;i>=0;i--)for(let j=observed.length-1;j>=0;j--)dp[i][j]=expected[i]===observed[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
  const pairs=[];let i=0,j=0;while(i<expected.length&&j<observed.length){if(expected[i]===observed[j]){pairs.push([i++,j++]);}else if(dp[i+1][j]>=dp[i][j+1])i++;else j++;}return pairs;
}
export function assessWords(text,assessment,already=[],threshold=70){
  const ts=targets(text),flat=ts.flatMap((t,position)=>t.atoms.map(atom=>({atom,position})));
  const observed=assessment.filter(w=>w.error!=='Insertion').flatMap(w=>normalize(w.word).map(atom=>({atom,valid:Number.isFinite(w.accuracy)&&w.accuracy>=threshold&&(!w.error||w.error==='None')})));
  if(!observed.length)return [...already];
  if(observed.length===1){const candidates=ts.map((t,i)=>({t,i})).filter(({t,i})=>!already.includes(i)&&t.atoms.length===1&&t.atoms[0]===observed[0].atom);if(candidates.length&&observed[0].valid)return [...new Set([...already,candidates[0].i])].sort((a,b)=>a-b);}
  const pairs=alignWords(flat.map(w=>w.atom),observed.map(w=>w.atom));
  const matched=new Set(pairs.filter(([,j])=>observed[j].valid).map(([i])=>i));let offset=0;const passed=new Set(already);
  ts.forEach((t,i)=>{if(t.atoms.every((_,j)=>matched.has(offset+j)))passed.add(i);offset+=t.atoms.length;});
  return [...passed].sort((a,b)=>a-b);
}
export function lineAt(lines,time){let index=0;for(let i=0;i<lines.length;i++){if(time>=lines[i].start)index=i;else break;}return index;}
export function formatDuration(seconds){const s=Math.max(0,Math.round(Number(seconds)||0));return `${Math.floor(s/60)}`.padStart(2,'0')+':'+`${s%60}`.padStart(2,'0');}
export function restoreProgress(value,course){
  const clean={line:0,time:0,passed:{}};if(!value||value.version!==course.version)return clean;
  clean.line=Math.max(0,Math.min(course.lines.length-1,Number.isInteger(value.line)?value.line:0));
  clean.time=Number.isFinite(value.time)?Math.max(0,Math.min(course.duration,value.time)):course.lines[clean.line].start;
  for(const [key,positions] of Object.entries(value.passed||{})){const i=Number(key);if(!Number.isInteger(i)||!course.lines[i]||!Array.isArray(positions))continue;const count=targets(course.lines[i].text).length;clean.passed[i]=[...new Set(positions.filter(p=>Number.isInteger(p)&&p>=0&&p<count))];}return clean;
}
