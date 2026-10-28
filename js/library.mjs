import {formatDuration,restoreProgress,targets} from './core.mjs';

export function courseStudyState(course,saved){
  const {passed}=restoreProgress(saved,course);
  const total=course.lines.reduce((n,line)=>n+targets(line.text).length,0);
  const learned=Object.values(passed).reduce((n,positions)=>n+positions.length,0);
  return learned===0?'new':learned===total?'complete':'partial';
}
export function renderLibrary({courses,getSaved,onOpen,onMenu,onCloseMenu}){
  const list=document.getElementById('course-list');list.replaceChildren();
  document.getElementById('clip-count').textContent=String(courses.length);
  document.getElementById('open-menu').onclick=onMenu;
  document.getElementById('close-menu').onclick=onCloseMenu;
  document.getElementById('menu-brand').onclick=onCloseMenu;
  courses.forEach((course,index)=>{
    const state=courseStudyState(course,getSaved(course.id));
    const card=document.createElement('button');card.className='course-card';
    const stateName={new:'未学习',partial:'学习中',complete:'已完成'}[state];
    card.setAttribute('aria-label',`打开片段 ${index+1}：${course.title}，${formatDuration(course.duration)}，${stateName}`);
    const meta=document.createElement('span');meta.className='course-meta';
    const time=document.createElement('span');time.className='course-time';time.textContent=formatDuration(course.duration);
    const status=document.createElement('img');status.className='study-status';status.src=`assets/design/study-${state}.svg`;status.width=23;status.height=23;status.alt=stateName;
    meta.append(time,status);
    if(course.edition){const edition=document.createElement('span');edition.className='course-edition';edition.textContent=`${String(index+1).padStart(2,'0')} · ${course.edition}`;meta.append(edition);}
    const cover=document.createElement('img');cover.className='course-cover';cover.src=course.poster;cover.alt='';cover.loading='lazy';
    card.append(meta,cover);card.onclick=()=>onOpen(index);list.append(card);
  });
  const movies=document.getElementById('movie-list');movies.replaceChildren();
  // The design's repeated rows are examples. Only show the film actually available.
  const film=document.createElement('button');film.className='movie-option';film.setAttribute('aria-current','true');film.setAttribute('aria-label','The Intern，2015，打开片段列表');
  const name=document.createElement('span');name.className='movie-name';name.textContent='The Intern';
  const year=document.createElement('span');year.className='movie-year';year.textContent='2015';
  const thumbnail=document.createElement('img');thumbnail.className='movie-thumb';thumbnail.src=courses[0].poster;thumbnail.alt='';
  film.append(name,year,thumbnail);film.onclick=onCloseMenu;movies.append(film);
}
