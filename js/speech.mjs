// Browser recognition is transcription, not a pronunciation score. No API key.
export class SpeechSession {
  constructor({onReady,onTranscript,onLevel,onError}) {
    Object.assign(this,{onReady,onTranscript,onLevel,onError});
    this.stopped=false;this.run=0;this.retries=0;
  }
  async start() {
    if(this.stopped)return;
    if(!window.isSecureContext)throw new Error('请使用 HTTPS 地址打开，才能开启麦克风；电脑可使用 localhost');
    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!Recognition)throw new Error('当前浏览器不支持跟读，请用 Safari 或支持语音识别的 Chrome 打开');
    this.Recognition=Recognition;
    // Start inside the user's click, before any permission awaits.
    this.listen();
    if(!this.stopped)await this.startMeter();
  }
  listen() {
    if(this.stopped)return;
    const recognition=new this.Recognition(),run=++this.run;
    const startedAt=Date.now();let heardSpeech=false;
    this.recognizer=recognition;
    recognition.lang='en-US';recognition.continuous=true;recognition.interimResults=true;recognition.maxAlternatives=1;
    const active=()=>!this.stopped&&this.recognizer===recognition;
    recognition.onstart=()=>{if(!active())return;clearTimeout(this.startTimer);if(!this.idleTimer)this.touch();this.onReady?.();};
    recognition.onspeechstart=()=>{if(active()){heardSpeech=true;this.touch();}};
    recognition.onresult=event=>{
      if(!active())return;
      const segments=Array.from(event.results,(result,i)=>({id:`${run}:${i}`,text:result[0]?.transcript||'',final:result.isFinal}));
      if(segments.some(s=>s.text.trim())){heardSpeech=true;this.touch();this.retries=0;}
      this.onTranscript?.(segments);
    };
    recognition.onerror=event=>{
      if(!active())return;
      if(event.error==='no-speech')return;
      this.fail(speechError(event));
    };
    recognition.onend=()=>{
      if(!active())return;
      this.recognizer=null;
      clearTimeout(this.startTimer);this.onTranscript?.([]);
      // A normal utterance ending is not a failed attempt. Keep listening for
      // second/third readings, with the same progress, until genuine inactivity.
      // Only rapid empty terminations count towards the restart-loop guard.
      this.retries=!heardSpeech&&Date.now()-startedAt<1000?this.retries+1:0;
      if(this.retries>2){this.fail('识别已暂停，点击跟读按钮可继续');return;}
      this.restartTimer=setTimeout(()=>{try{this.listen();}catch(error){this.fail(speechError(error));}},300);
    };
    this.startTimer=setTimeout(()=>this.fail('识别启动超时，请检查浏览器麦克风权限后重试'),15000);
    try{recognition.start();}catch(error){this.stop();throw error;}
  }
  touch(){clearTimeout(this.idleTimer);this.idleTimer=setTimeout(()=>this.fail('跟读已暂停，点击按钮可继续'),60000);}
  async startMeter(){
    // This independent stream only drives the volume meter. A meter failure must
    // not block the browser's own recognition input, notably on mobile.
    if(!navigator.mediaDevices?.getUserMedia)return;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(this.stopped){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(!Audio){stream.getTracks().forEach(t=>t.stop());return;}
      const context=this.context=new Audio();await context.resume();if(this.stopped)return;
      const source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();analyser.fftSize=256;source.connect(analyser);
      const bins=new Uint8Array(analyser.fftSize);
      const meter=()=>{if(this.stopped)return;analyser.getByteTimeDomainData(bins);const rms=Math.sqrt(bins.reduce((sum,x)=>sum+((x-128)/128)**2,0)/bins.length);this.onLevel?.(Math.min(1,rms*7));this.meterId=requestAnimationFrame(meter);};meter();
    }catch{this.stream?.getTracks().forEach(t=>t.stop());if(this.context?.state!=='closed')this.context?.close().catch(()=>{});this.onLevel?.(0);}
  }
  fail(message){if(this.stopped)return;this.stop();this.onError?.(new Error(message));}
  stop(){
    if(this.stopped)return;this.stopped=true;
    clearTimeout(this.idleTimer);clearTimeout(this.startTimer);clearTimeout(this.restartTimer);cancelAnimationFrame(this.meterId);
    const recognition=this.recognizer;this.recognizer=null;
    if(recognition){recognition.onstart=recognition.onresult=recognition.onerror=recognition.onend=recognition.onspeechstart=null;try{recognition.abort();}catch{}}
    this.stream?.getTracks().forEach(t=>t.stop());if(this.context&&this.context.state!=='closed')this.context.close().catch(()=>{});
    this.onLevel?.(0);
  }
}
export function speechError(error){
  const messages={
    'not-allowed':'麦克风或语音识别未授权，请在浏览器设置中允许后重试',
    'service-not-allowed':'浏览器语音服务不可用；Safari 请检查 Siri 与听写设置，或换支持识别的浏览器',
    'audio-capture':'麦克风暂时不可用，请检查设备后重试',
    'network':'浏览器语音服务连接失败，请检查网络或换 Safari 重试',
    'language-not-supported':'当前浏览器暂不支持英语识别，请检查系统语言设置',
    'aborted':'识别已中断，点击跟读按钮可继续',
    NotAllowedError:'麦克风未授权，请在浏览器设置中允许后重试',
    NotFoundError:'没有找到可用麦克风',
    NotReadableError:'麦克风暂时不可用，请关闭其他录音程序后重试'
  };
  return messages[error?.error||error?.name]||error?.message||'跟读暂时不可用，请点击按钮重试';
}
