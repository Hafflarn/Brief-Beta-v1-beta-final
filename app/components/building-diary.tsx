"use client";
import FilePicker from "./file-picker";
import { useState } from 'react';
import type { Member, Order } from '../../lib/beta';
import { date as displayDate } from '../../lib/beta';
import { DiaryContent, DiaryHeader, DiaryReport, Personnel, diaryTexts, emptyDiary } from '../../lib/building-diary';
import * as cloud from '../../lib/beta-cloud';
type Props = {order:Order;me:Member;header:DiaryHeader;reports:DiaryReport[];canEdit:boolean;requestedReport?:string;onDirty:(dirty:boolean)=>void;onSave:(report:string,date:string,content:DiaryContent,files:File[],submit:boolean)=>Promise<boolean>};
export default function BuildingDiary(props:Props) {
 const [selected,setSelected]=useState(props.requestedReport || '');
 const [changed,setChanged]=useState(false);
 const report=props.reports.find(r=>r.id===selected);
 const choose=(id:string)=>{if(changed&&!confirm('Du har osparade ändringar. Vill du lämna rapporten?'))return;setSelected(id);setChanged(false);props.onDirty(false)};
 return <section className="building-diary">
  <div className="section-heading"><div><h2>Byggdagbok</h2><p className="muted">Dokumentera dagens arbete. Sparade rapporter skickas till orderskaparens inkorg och låses.</p></div>{props.canEdit&&<button onClick={()=>choose('')}>+ Ny rapport</button>}</div>
  {!!props.reports.length&&<div className="diary-reports" aria-label="Dagboksrapporter">{props.reports.map(r=><button key={r.id} className={selected===r.id?'selected':''} onClick={()=>choose(r.id)}>{r.date} · {r.header.author}<small>{r.submittedAt?'Sparad rapport':'Mitt utkast'}</small></button>)}</div>}
  {(report || props.canEdit) ? <DiaryForm key={selected || 'new'} {...props} report={report} onChanged={v=>{setChanged(v);props.onDirty(v)}} onSaved={id=>{setChanged(false);props.onDirty(false);setSelected(id)}} /> : <p className="empty">Inga sparade rapporter ännu. {props.order.buildingDiary?'Du behöver vara ansluten till en öppen order för att skriva.':'Byggdagboken är avmarkerad. Tidigare rapporter finns kvar.'}</p>}
 </section>;
}
function DiaryForm(props:Props & {report?:DiaryReport;onChanged:(v:boolean)=>void;onSaved:(id:string)=>void}) {
 const [content,setContent]=useState<DiaryContent>(()=>structuredClone(props.report?.content || emptyDiary()));
 const [reportDate,setReportDate]=useState(props.report?.date || new Date().toLocaleDateString('sv-SE'));
 const [files,setFiles]=useState<File[]>([]);
 const [saving,setSaving]=useState(false);
 const [message,setMessage]=useState('');
 const [reportId]=useState(()=>props.report?.id || crypto.randomUUID());
 const locked=!!props.report?.submittedAt || !props.canEdit || (!!props.report && props.report.author!==props.me.id);
 const header=props.report?.header || props.header;
 function update(patch:Partial<DiaryContent>){setContent(v=>({...v,...patch}));props.onChanged(true)}
 function staff(index:number,patch:Partial<Personnel>){update({personnel:content.personnel.map((r,i)=>i===index?{...r,...patch}:r)})}
 async function save(submit:boolean){if(saving||locked)return;setSaving(true);setMessage('');try{if(submit&&!content.work.trim())throw Error('Beskriv dagens utförda arbeten innan du sparar rapporten.');if(!reportDate)throw Error('Ange rapportdatum.');if(content.files.length+files.length>5)throw Error('Högst fem bilagor per rapport.');if(await props.onSave(reportId,reportDate,content,files,submit)){setFiles([]);props.onSaved(reportId);setMessage(submit?'Rapporten är sparad och skickad till ansvarig platschefs inkorg.':'Utkast sparat. Det har inte skickats till inkorgen.')}}catch(e){setMessage(e instanceof Error?e.message:'Rapporten kunde inte sparas.')}finally{setSaving(false)}}
 return <form onSubmit={e=>{e.preventDefault();void save(true)}}>
  <section className="panel content-panel diary-header"><h3>Dagens rapport</h3><p className="muted">Hämtat från arbetsordern · fasta uppgifter</p><div className="diary-fields">
   {([['Projekt',header.project],['Projektnummer',header.projectNumber],['Arbetsordernummer',header.orderNumber],['Beställare',header.customer],['Adress',header.address],['Ansvarig upprättare',header.author],['Ansvarig platschef',header.siteManager]] as const).map(([label,value])=><label key={label}>{label}<span className="diary-header-value">{value || "—"}</span></label>)}
   <label>Datum<input type="date" value={reportDate} disabled={locked||saving} onChange={e=>{setReportDate(e.target.value);props.onChanged(true)}} required /></label>
  </div></section>
  {props.report?.submittedAt&&<p className="notice">Sparad {displayDate(props.report.submittedAt)}. Rapporten är låst.</p>}
  <fieldset disabled={locked||saving}>
   <section className="panel content-panel"><h3>Väderförhållanden</h3><div className="weather-options">{['Sol','Molnigt','Regn','Snö','Blåsigt'].map(w=><label className="check-label" key={w}><input type="checkbox" checked={content.weather.includes(w)} onChange={e=>update({weather:e.target.checked?[...content.weather,w]:content.weather.filter(v=>v!==w)})}/>{w}</label>)}<label>Temperatur (°C)<input type="number" min={-80} max={80} step="0.1" value={content.temperature} onChange={e=>update({temperature:e.target.value})}/></label></div></section>
   <section className="panel content-panel"><h3>Närvarande personal</h3>{content.personnel.map((r,i)=><div className="diary-personnel" key={i}>
    <label>Yrkesgrupp<input value={r.trade} maxLength={150} onChange={e=>staff(i,{trade:e.target.value})}/></label>
    <label>Företag / namn<input value={r.company} maxLength={200} onChange={e=>staff(i,{company:e.target.value})}/></label>
    <label>Antal<input type="number" min={0} max={10000} step={1} value={r.count} onChange={e=>staff(i,{count:e.target.value})}/></label>
    <label>Timmar totalt<input type="number" min={0} max={100000} step="0.25" value={r.hours} onChange={e=>staff(i,{hours:e.target.value})}/></label>
    {!locked&&<button type="button" aria-label={'Ta bort personalrad '+(i+1)} onClick={()=>update({personnel:content.personnel.filter((_,n)=>n!==i)})}>×</button>}
   </div>)}{!locked&&<button type="button" disabled={content.personnel.length>=50} onClick={()=>update({personnel:[...content.personnel,{trade:'',company:'',count:'',hours:''}]})}>+ Lägg till rad</button>}</section>
   <div className="diary-texts">{[
    {title:'Dagens arbete',keys:['work','deliveries','equipment']},
    {title:'Avvikelser och uppföljning',keys:['deviations','decisions','safety','quality']},
    {title:'Nästa arbetsdag',keys:['nextDay']}
   ].map(group=><section className="panel content-panel diary-group" key={group.title}><h3>{group.title}</h3><div className="diary-group-fields">{diaryTexts.filter(([key])=>group.keys.includes(key)).map(([key,label])=><label className={'diary-'+key} key={key}>{label}{key==='work'&&<span className="required-mark"> *</span>}<textarea rows={key==='work'?4:3} maxLength={10000} value={content[key]} onChange={e=>update({[key]:e.target.value})} required={key==='work'} /></label>)}</div></section>)}</div>
   <section className="panel content-panel"><h3>Fotografier och bilagor</h3>{!locked&&<FilePicker label="Fotografier och dokument" files={files} disabled={saving} onChange={selected=>{setFiles(selected);props.onChanged(true)}}/>}</section>
  </fieldset>
  {!!content.files.length&&<div className="actions">{content.files.map(f=><button key={f.id} type="button" onClick={()=>void cloud.download(f).catch(e=>setMessage(String(e)))}>{f.name} ↓</button>)}</div>}
  {message&&<p role="status" className="notice">{message}</p>}
  {!locked&&<div className="form-actions diary-save"><span className="muted">Rapporten låses när den sparas och skickas.</span><button type="button" disabled={saving} onClick={()=>void save(false)}>Spara utkast</button><button className="primary" type="submit" disabled={saving}>{saving?'Sparar…':'Spara dagboksrapport'}</button></div>}
 </form>;
}
