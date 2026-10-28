import {targets,RecognitionProgress,lineAt,formatDuration,restoreProgress} from './js/core.mjs';
import {SpeechSession,speechError} from './js/speech.mjs';
import {renderLibrary} from './js/library.mjs';

const $=id=>document.getElementById(id),app=$('app'),video=$('video'),transcript=$('transcript');
const courses=window.CUE_COURSES,storageKey='cue-practice-v2';
let stored={};try{stored=JSON.parse(localStorage.getItem(storageKey)||'{}');}catch{}
let courseIndex=Math.max(0,courses.findIndex(c=>c.id===stored.course)),course,progress,rows=[];
let selectedWord=-1,preview=[],view='practice';
let mode='paused',current=0,translation=-1,epoch=0,session=null,frame=0,passTimer,noticeTimer,scrollTimer;
let programmatic=false,programTimer,manualScroll=false,resumeAfterScroll=false,replayEnd=null,replayReading=false,loadEpoch=0;
const practicing=()=>['reading','requesting','passed','replaying-reading'].includes(mode);
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

function notice(message,persistent=false){
  clearTimeout(noticeTimer);$('notice').replaceChildren(document.createTextNode(message));$('notice').hidden=false;
  const close=document.createElement('button');close.textContent='关闭';close.onclick=()=>{$('notice').hidden=true;};$('notice').append(close);
  if(!persistent)noticeTimer=setTimeout(()=>{$('notice').hidden=true;},4500);
}
function save(){
  if(!course)return;stored.course=course.id;stored.courses??={};
  stored.courses[course.id]={version:course.version,line:current,time:Number.isFinite(video.currentTime)?video.currentTime:0,passed:progress.passed};
  try{localStorage.setItem(storageKey,JSON.stringify(stored));}catch{}
}
function setMode(value){
  mode=value;app.dataset.mode=mode;app.classList.toggle('is-practicing',practicing());
  $('speak').setAttribute('aria-pressed',String(practicing()));$('speak').setAttribute('aria-busy',String(mode==='requesting'));$('speak').setAttribute('aria-label',mode==='requesting'?'正在开启语音识别，点击重试':practicing()?'正在跟读，点击重新开始':'开始跟读');
  $('transport').setAttribute('aria-label',practicing()?'退出跟读':['playing','replaying'].includes(mode)?'暂停视频':'继续播放');
  $('video-hit').setAttribute('aria-label',practicing()?'退出跟读并播放当前句':['playing','replaying'].includes(mode)?'暂停视频':'播放视频');
  $('previous').disabled=practicing()||courseIndex===0;$('next').disabled=practicing()||courseIndex===courses.length-1;
}
function disposeSession(){preview=[];epoch++;session?.stop();session=null;clearTimeout(passTimer);document.querySelectorAll('.wave-live i').forEach(el=>el.style.height='4px');}
function stopReading(){disposeSession();video.pause();replayEnd=null;replayReading=false;setMode('paused');updateRows();if(video.readyState>=1)video.currentTime=course.lines[current].start;save();}
function updateRows(){
  rows.forEach((row,i)=>{
    row.classList.toggle('current',i===current);row.classList.toggle('translated',i===translation);
    row.dataset.distance=Math.abs(i-current)>3?'far':String(Math.abs(i-current));
    row.querySelector('.sentence-text').setAttribute('aria-current',i===current?'true':'false');
    row.querySelector('.sentence-text').setAttribute('aria-expanded',String(i===translation));
    row.querySelector('.sentence-text').title=i===translation?'点击单词查看对应中文；左右方向键选择单词':'';
    row.querySelector('.translation').hidden=i!==translation;
    const passed=progress.passed[i]||[];row.querySelectorAll('.word').forEach((word,n)=>{word.classList.toggle('passed',passed.includes(n));word.classList.toggle('tentative',i===current&&preview.includes(n));word.classList.toggle('selected',i===translation&&n===selectedWord);});
    renderTranslation(row.querySelector('.translation'),course.lines[i],i===translation?selectedWord:-1);
    row.dataset.complete=String(passed.length===targets(course.lines[i].text).length);
  });
}
function renderTranslation(element,line,position){
  const fragment=line.wordTranslations?.[position],start=fragment?line.zh.indexOf(fragment):-1;
  element.replaceChildren();
  if(start<0){element.textContent=line.zh;return;}
  const mark=document.createElement('mark');mark.textContent=fragment;
  element.append(document.createTextNode(line.zh.slice(0,start)),mark,document.createTextNode(line.zh.slice(start+fragment.length)));
}
function selectWord(position){selectedWord=position===selectedWord?-1:position;updateRows();}
function scrollToCurrent(smooth=true){
  if(manualScroll||view!=='practice')return;programmatic=true;clearTimeout(programTimer);
  const top=rows[current].offsetTop-transcript.offsetTop;
  let anchor=current===0?36:Math.min(118,transcript.clientHeight*.34);
  if(translation===current){const card=rows[current].querySelector('.translation');anchor=Math.min(anchor,Math.max(12,transcript.clientHeight-rows[current].offsetHeight-card.offsetHeight-24));}
  transcript.scrollTo({top:Math.max(0,top-anchor),behavior:smooth&&!reduced()?'smooth':'instant'});
  programTimer=setTimeout(()=>{programmatic=false;},smooth?650:80);
}
function setCurrent(index,{scroll=true,smooth=true}={}){current=Math.max(0,Math.min(course.lines.length-1,index));translation=-1;selectedWord=-1;updateRows();if(scroll)scrollToCurrent(smooth);}
function render(){
  transcript.replaceChildren();rows=[];
  course.lines.forEach((line,i)=>{
    const row=document.createElement('article');row.className='sentence';row.dataset.index=i;
    const marker=document.createElement('button');marker.className='sentence-marker';marker.setAttribute('aria-label',`重听第 ${i+1} 句原声`);
    const icon=document.createElement('img');icon.src='assets/design/sentence-play.svg';icon.width=12;icon.height=8;icon.alt='';marker.append(icon);marker.onclick=()=>replay(i);
    const text=document.createElement('button');text.className='sentence-text';text.setAttribute('aria-controls',`translation-${i}`);
    let offset=0,position=0;for(const word of targets(line.text)){text.append(document.createTextNode(line.text.slice(offset,word.start)));const span=document.createElement('span');span.className='word';span.dataset.word=position++;span.textContent=word.text;text.append(span);offset=word.end;}text.append(document.createTextNode(line.text.slice(offset)));
    text.onclick=event=>{const word=event.target.closest('.word');if(translation===i&&word&&!practicing())selectWord(Number(word.dataset.word));else selectSentence(i);};
    text.onkeydown=event=>{if(translation!==i||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();selectedWord=Math.max(0,Math.min(targets(line.text).length-1,selectedWord+(event.key==='ArrowRight'?1:-1)));updateRows();};
    const chinese=document.createElement('div');chinese.className='translation';chinese.id=`translation-${i}`;chinese.textContent=line.zh;chinese.hidden=true;
    row.append(marker,text,chinese);rows.push(row);transcript.append(row);
  });
  $('previous-number').textContent=courseIndex>0?String(courseIndex):'';$('next-number').textContent=courseIndex<courses.length-1?String(courseIndex+2):'';
  updateRows();
}
async function loadCourse(index){
  save();disposeSession();video.pause();clearTimeout(scrollTimer);clearTimeout(programTimer);manualScroll=false;programmatic=false;replayEnd=null;replayReading=false;
  courseIndex=index;course=courses[index];progress=restoreProgress(stored.courses?.[course.id],course);current=progress.line;translation=-1;
  setMode('paused');render();setDuration(course.duration);document.title=`The Intern · ${course.title}`;
  video.poster=course.poster;$('poster').src=course.poster;$('poster').hidden=false;video.src=course.video;video.load();const generation=++loadEpoch;
  const restore=()=>{if(generation!==loadEpoch)return;video.currentTime=progress.time;setCurrent(current,{smooth:false});updateTime();};
  video.addEventListener('loadedmetadata',restore,{once:true});requestAnimationFrame(()=>scrollToCurrent(false));
}
function setDuration(duration){const value=formatDuration(duration);if($('duration').textContent!==value)$('duration').textContent=value;$('duration').setAttribute('aria-label',`视频总时长 ${value}`);}
function updateTime(){
  $('poster').hidden=video.currentTime>.12;
  const duration=Number.isFinite(video.duration)?video.duration:course.duration;
  const percent=Math.min(100,Math.max(0,video.currentTime/duration*100));$('video-progress').style.width=`${percent}%`;document.querySelector('.video-progress').setAttribute('aria-valuenow',String(Math.round(percent)));
  if(mode==='playing'||mode==='replaying'||mode==='replaying-reading'){
    if(replayEnd!==null&&video.currentTime>=replayEnd-.025){finishReplay();return;}
    if(mode==='playing'){const index=lineAt(course.lines,video.currentTime);if(index!==current){setCurrent(index);save();}}
  }
}
function tick(){updateTime();if(!video.paused)frame=requestAnimationFrame(tick);}
async function play(){
  const wasPracticing=practicing();if(wasPracticing)stopReading();
  translation=-1;replayEnd=null;replayReading=false;manualScroll=false;updateRows();
  if(video.ended||video.currentTime>=video.duration-.05){setCurrent(0);video.currentTime=0;}
  clearTimeout(scrollTimer);resumeAfterScroll=false;
  setMode('playing');try{await video.play();}catch{setMode('paused');notice('点击视频开始播放');}
}
function pause(){video.pause();replayEnd=null;replayReading=false;clearTimeout(scrollTimer);manualScroll=false;resumeAfterScroll=false;if(!practicing())setMode('paused');scrollToCurrent();save();}
function toggleVideo(){if(practicing())return play();if(video.paused)return play();replayEnd=null;replayReading=false;pause();}
function selectSentence(index){
  const same=translation===index;
  if(practicing()){disposeSession();setMode('paused');}
  video.pause();replayEnd=null;replayReading=false;manualScroll=false;clearTimeout(scrollTimer);
  setCurrent(index,{scroll:false});video.currentTime=course.lines[index].start;setMode('paused');translation=same?-1:index;updateRows();scrollToCurrent();save();
}
async function replay(index){
  replayReading=practicing();disposeSession();video.pause();manualScroll=false;setCurrent(index);video.currentTime=course.lines[index].start;replayEnd=course.lines[index].end;
  setMode(replayReading?'replaying-reading':'replaying');
  try{await video.play();}catch{replayEnd=null;replayReading=false;setMode('paused');notice('点击视频重听当前句');}
}
function finishReplay(){
  const resume=replayReading;replayEnd=null;replayReading=false;video.pause();video.currentTime=Math.max(course.lines[current].start,course.lines[current].end-.03);
  setMode('paused');if(resume)beginReading(false);else save();
}
async function beginReading(resetCompleted=true){
  video.pause();disposeSession();clearTimeout(scrollTimer);resumeAfterScroll=false;replayEnd=null;replayReading=false;translation=-1;manualScroll=false;
  if(resetCompleted&&(progress.passed[current]||[]).length===targets(course.lines[current].text).length)progress.passed[current]=[];
  updateRows();setMode('requesting');scrollToCurrent();$('notice').hidden=true;
  const mine=epoch,index=current,id=course.id;
  const recognitionProgress=new RecognitionProgress(course.lines[index].text,progress.passed[index]||[]);
  const valid=()=>mine===epoch&&index===current&&id===course.id;
  session=new SpeechSession({
    onReady:()=>{if(!valid())return;setMode('reading');},
    onLevel:level=>{if(!valid())return;document.querySelectorAll('.wave-live i').forEach((el,i)=>el.style.height=`${4+12*Math.min(1,level*[.65,1,.8,.5][i])}px`);},
    onTranscript:segments=>{
      if(!valid()||mode!=='reading')return;
      const result=recognitionProgress.update(segments);
      progress.passed[index]=result.passed;preview=result.preview;updateRows();save();
      if(result.complete){
        session?.stop();session=null;setMode('passed');
        passTimer=setTimeout(()=>{
          if(!valid())return;
          if(index===course.lines.length-1){disposeSession();setMode('paused');updateRows();save();return;}
          setCurrent(index+1);video.currentTime=course.lines[current].start;save();beginReading(false);
        },450);
      }
    },
    onError:error=>{if(!valid())return;disposeSession();setMode('paused');updateRows();notice(speechError(error),true);save();}
  });
  try{await session.start(course.lines[current].text);}catch(error){if(valid()){disposeSession();setMode('paused');updateRows();notice(speechError(error),true);}}
}
function beginManualScroll(){
  clearTimeout(scrollTimer);scrollTimer=setTimeout(settleScroll,240);
  if(manualScroll)return;manualScroll=true;programmatic=false;clearTimeout(programTimer);resumeAfterScroll=practicing();
  video.pause();disposeSession();replayEnd=null;replayReading=false;translation=-1;if(!resumeAfterScroll)setMode('paused');updateRows();
}
function settleScroll(){
  if(!manualScroll)return;
  const anchor=transcript.getBoundingClientRect().top+Math.min(118,transcript.clientHeight*.34);
  const index=rows.reduce((best,row,i)=>Math.abs(row.getBoundingClientRect().top-anchor)<Math.abs(rows[best].getBoundingClientRect().top-anchor)?i:best,0);
  const resume=resumeAfterScroll;manualScroll=false;resumeAfterScroll=false;setCurrent(index);video.currentTime=course.lines[index].start;save();if(resume)beginReading(false);
}
transcript.addEventListener('wheel',beginManualScroll,{passive:true});transcript.addEventListener('touchmove',beginManualScroll,{passive:true});
transcript.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(event.key))beginManualScroll();});
transcript.addEventListener('scroll',()=>{if(programmatic&&!manualScroll)return;if(!manualScroll)return;clearTimeout(scrollTimer);scrollTimer=setTimeout(settleScroll,200);},{passive:true});
transcript.addEventListener('click',event=>{if(event.target===transcript){translation=-1;updateRows();}});
$('video-hit').onclick=toggleVideo;$('transport').onclick=()=>practicing()?stopReading():['playing','replaying'].includes(mode)?pause():play();$('speak').onclick=()=>beginReading();
$('previous').onclick=()=>{if(courseIndex>0&&!practicing())loadCourse(courseIndex-1);};$('next').onclick=()=>{if(courseIndex<courses.length-1&&!practicing())loadCourse(courseIndex+1);};
$('home').onclick=()=>navigate('library');
video.addEventListener('play',()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(tick);});
video.addEventListener('pause',()=>{cancelAnimationFrame(frame);if(mode==='playing')setMode('paused');save();});
video.addEventListener('timeupdate',updateTime);video.addEventListener('loadedmetadata',()=>{setDuration(Number.isFinite(video.duration)?video.duration:course.duration);updateTime();});
video.addEventListener('ended',()=>{if(replayEnd!==null)finishReplay();else{setMode('paused');save();}});
video.addEventListener('error',()=>notice('视频加载失败，请刷新页面重试',true));
document.addEventListener('visibilitychange',()=>{if(document.hidden){video.pause();if(practicing())stopReading();save();}});
window.addEventListener('pagehide',()=>{disposeSession();save();});window.addEventListener('resize',()=>requestAnimationFrame(()=>scrollToCurrent(false)));
window.addEventListener('keydown',event=>{if(view!=='practice'){if(event.key==='Escape')navigate(view==='menu'?'library':'practice');return;}if(event.key==='Escape'){if(practicing())stopReading();translation=-1;updateRows();$('notice').hidden=true;}if(event.code==='Space'&&!['BUTTON','INPUT','TEXTAREA'].includes(document.activeElement.tagName)){event.preventDefault();toggleVideo();}});
function showView(next,index){
  if(next!=='practice'){
    if(practicing())stopReading();else pause();
    disposeSession();clearTimeout(scrollTimer);clearTimeout(programTimer);manualScroll=false;resumeAfterScroll=false;
    translation=-1;selectedWord=-1;updateRows();save();$('notice').hidden=true;
    renderLibrary({courses,getSaved:id=>stored.courses?.[id],onOpen:i=>navigate('practice',i),onMenu:()=>navigate('menu'),onCloseMenu:()=>navigate('library')});
  }
  view=next;app.hidden=next!=='practice';$('library').hidden=next!=='library';$('movie-menu').hidden=next!=='menu';
  if(next==='practice'){
    if(Number.isInteger(index)&&index!==courseIndex)loadCourse(index);
    document.title=`The Intern · ${course.title}`;
    requestAnimationFrame(()=>scrollToCurrent(false));app.focus({preventScroll:true});
  }else{
    document.title=next==='library'?'The Intern · 片段列表':'电影菜单';
    $(next==='library'?'library':'movie-menu').focus({preventScroll:true});
  }
}
function navigate(next,index){
  history.pushState({view:next,courseIndex:Number.isInteger(index)?index:courseIndex},'',`#${next}`);showView(next,index);
}
window.addEventListener('popstate',event=>showView(event.state?.view||'practice',event.state?.courseIndex));
loadCourse(courseIndex);
const initialView=['library','menu'].includes(location.hash.slice(1))?location.hash.slice(1):'practice';
history.replaceState({view:initialView,courseIndex},'',location.href);showView(initialView);
// Capability errors are shown on demand; the page never requests a mic on load.

