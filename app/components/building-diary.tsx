"use client";
import { useState } from "react";
import FilePicker from "./file-picker";
import type { Member, Project } from "../../lib/beta";
import { date as displayDate } from "../../lib/beta";
import { DiaryContent, DiaryHeader, DiaryReport, Personnel, emptyDiary } from "../../lib/building-diary";
import * as cloud from "../../lib/beta-cloud";
type Props = { project:Project; me:Member; header:DiaryHeader; reports:DiaryReport[]; canEdit:boolean; requestedReport?:string; onDirty:(dirty:boolean)=>void; onSave:(report:string,date:string,content:DiaryContent,files:File[],submit:boolean)=>Promise<boolean>; onAck:(report:string,ack:"siteManager"|"verifier")=>Promise<boolean> };
type TextKey = Exclude<keyof DiaryContent,"weather"|"temperature"|"personnel"|"files">;
const groups:{title:string;fields:[TextKey,string,string][]}[] = [
 {title:"Dagens arbete",fields:[["ongoing","Påbörjade och pågående arbeten","Ange arbetsmoment, plats och hur långt arbetet kommit."],["completed","Färdigställda arbeten","Ange vilka arbeten som blev färdiga idag."],["deliveries","Leveranser","Material, mängd och eventuella avvikelser."],["equipment","Maskiner och utrustning","Använd utrustning och eventuell stilleståndstid."]]},
 {title:"Avvikelser och ÄTA",fields:[["deviations","Avvikelser, störningar och hinder","Vad hände, när och hur påverkades arbetet?"],["ata","Ändringar och tilläggsarbeten (ÄTA)","Beskriv arbetet, beställare, datum och hänvisning till ÄTA-nummer eller beställning."],["decisions","Beslut och åtgärder","Beslut, ansvarig person och datum."]]},
 {title:"Direktiv, anmälningar och besiktningar",fields:[["directives","Direktiv från","Ange person/instans, datum och instruktion. Hänvisa till bifogat meddelande."],["notifications","Anmälan till","Ange mottagare, datum och vad som anmälts."],["inspections","Besiktningar","Ange typ, person/instans, datum, resultat och protokoll."]]},
 {title:"Ritningar och egenkontroll",fields:[["drawings","Mottagna ritningar","Ange disciplin, ritningsnummer, revision, mottagningsdatum och följesedel."],["controlPlan","Kontrollplan / referens","Ange kontrollplanens nummer eller dokumentreferens."],["selfChecks","Utförda egenkontroller","Ange kontrollpunkt, resultat, utförare och hänvisning till dokumentation."],["quality","Kvalitet och övriga kontroller","Dokumentera iakttagelser och åtgärder."]]},
 {title:"Arbetsmiljö och skyddsrond",fields:[["safetyRound","Skyddsrond","Datum, deltagare och iakttagelser."],["safetyActions","Föreslagna åtgärder","Åtgärd, ansvarig och när den ska vara klar."],["safetyCompleted","Avklarade åtgärder","Åtgärd, vem som utförde den och datum."],["safety","Övrig arbetsmiljö och säkerhet",""]]},
 {title:"Övrigt och nästa arbetsdag",fields:[["other","Övriga noteringar",""] ,["nextDay","Planering för nästa arbetsdag",""]]}
];
export default function BuildingDiary(props:Props) {
 const [selected,setSelected]=useState(props.requestedReport || "");
 const [changed,setChanged]=useState(false);
 const report=props.reports.find(r=>r.id===selected);
 function choose(id:string) {if(changed&&!confirm("Du har osparade ändringar. Vill du lämna rapporten?"))return;setSelected(id);setChanged(false);props.onDirty(false);}
 return <section className="building-diary">
  <div className="section-heading"><div><h2>Projektets byggdagbok</h2><p className="muted">En samlad dagbok för projektet. Inskickade rapporter låses och hamnar i ansvarig platschefs inkorg.</p></div>{props.canEdit&&<button onClick={()=>choose("")}>+ Ny dagrapport</button>}</div>
  {!!props.reports.length&&<div className="diary-reports" aria-label="Dagboksrapporter">{props.reports.map(r=><button key={r.id} className={selected===r.id?"selected":""} onClick={()=>choose(r.id)}>Dagrapport {r.number || "—"} · {r.date}<small>{r.header.author} · {r.submittedAt?"Inskickad":"Mitt utkast"}</small></button>)}</div>}
  {(report || props.canEdit)?<DiaryForm key={selected || "new"} {...props} report={report} onChanged={v=>{setChanged(v);props.onDirty(v)}} onSaved={id=>{setChanged(false);props.onDirty(false);setSelected(id)}}/>:<p className="empty">{props.reports.length?"Välj en rapport för att läsa den.":"Inga dagrapporter ännu."}{props.project.archived?" Projektet är arkiverat.":""}</p>}
 </section>;
}
function DiaryForm(props:Props & {report?:DiaryReport;onChanged:(v:boolean)=>void;onSaved:(id:string)=>void}) {
 const [content,setContent]=useState<DiaryContent>(()=>({...emptyDiary(),...structuredClone(props.report?.content || {}),personnel:(props.report?.content.personnel || []).map(r=>({...r,type:r.type || "Ej angivet"}))}));
 const [reportDate,setReportDate]=useState(props.report?.date || new Date().toLocaleDateString("sv-SE"));
 const [files,setFiles]=useState<File[]>([]),[saving,setSaving]=useState(false),[message,setMessage]=useState("");
 const [reportId]=useState(()=>props.report?.id || crypto.randomUUID());
 const locked=!!props.report?.submittedAt || !props.canEdit || (!!props.report && props.report.author!==props.me.id);
 const header=props.report?.header || props.header;
 function update(patch:Partial<DiaryContent>){setContent(v=>({...v,...patch}));props.onChanged(true)}
 function staff(index:number,patch:Partial<Personnel>){update({personnel:content.personnel.map((r,i)=>i===index?{...r,...patch}:r)})}
 async function save(submit:boolean) {if(saving||locked)return;setSaving(true);setMessage("");try{
  if(submit && ![content.ongoing,content.completed,content.work].some(v=>v?.trim()))throw Error("Beskriv pågående eller färdigställda arbeten innan rapporten skickas.");
  if(!reportDate)throw Error("Ange rapportdatum.");if(content.files.length+files.length>5)throw Error("Högst fem bilagor per rapport.");
  if(await props.onSave(reportId,reportDate,content,files,submit)){setFiles([]);props.onSaved(reportId);setMessage(submit?"Dagrapporten är inskickad och låst. Ansvarig platschef har fått den i sin inkorg.":"Utkastet är sparat.");}
 }catch(e){setMessage(e instanceof Error?e.message:"Rapporten kunde inte sparas.")}finally{setSaving(false)}}
 const day=new Date(reportDate+"T12:00:00");const thursday=new Date(day);thursday.setDate(day.getDate()+3-(day.getDay()+6)%7);const week=1+Math.round((thursday.getTime()-new Date(thursday.getFullYear(),0,4).getTime())/604800000);
 const sum=(type?:string)=>content.personnel.filter(r=>!type||r.type===type).reduce((a,r)=>({count:a.count+(Number(r.count)||0),hours:a.hours+(Number(r.hours)||0)}),{count:0,hours:0});
 return <form onSubmit={e=>{e.preventDefault();void save(true)}}>
  <section className="panel content-panel diary-header"><h3>Dagrapport {props.report?.number || "· Ny rapport"}</h3><p className="muted">Projektuppgifter och ansvariga hämtas automatiskt. Rapportnummer tilldelas när utkastet sparas eller rapporten skickas.</p><div className="diary-fields">
   {([ ["Projekt",header.project],["Eget projektnummer",header.projectNumber],["Beställarens projektnummer",header.customerNumber || props.project.customerNumber],["Beställare",header.customer],["Arbetsplats / adress",header.address],["Ansvarig upprättare",header.author],["Ansvarig platschef",header.siteManager],["Beställare/kontrollant för kvittens",header.verifier || "Ej angiven"] ] as const).map(([label,value])=><div key={label}><small>{label}</small><span className="diary-header-value">{value || "—"}</span></div>)}
   <label>Rapportdatum<input type="date" value={reportDate} disabled={locked||saving} onChange={e=>{setReportDate(e.target.value);props.onChanged(true)}} required/></label>
   <div><small>Veckodag / vecka</small><span className="diary-header-value">{reportDate?`${day.toLocaleDateString("sv-SE",{weekday:"long"})} · vecka ${week}`:"—"}</span></div>
  </div>{header.orderNumber&&<p className="muted">Flyttad från arbetsorder {header.orderNumber}. Ursprungliga rapportuppgifter är bevarade.</p>}</section>
  {props.report?.submittedAt&&<p className="notice">Inskickad {displayDate(props.report.submittedAt)}. Innehållet är låst.</p>}
  <fieldset disabled={locked||saving}>
   <section className="panel content-panel"><h3>Väder</h3><div className="weather-options">{["Sol","Molnigt","Regn","Snö","Blåsigt"].map(w=><label className="check-label" key={w}><input type="checkbox" checked={content.weather.includes(w)} onChange={e=>update({weather:e.target.checked?[...content.weather,w]:content.weather.filter(v=>v!==w)})}/>{w}</label>)}<label>Temperatur (°C)<input type="number" min={-80} max={80} step="0.1" value={content.temperature} onChange={e=>update({temperature:e.target.value})}/></label></div></section>
   <section className="panel content-panel"><h3>Närvarande arbetsstyrka</h3>{content.personnel.map((r,i)=><div className="diary-personnel project-personnel" key={i}>
    <label>Personaltyp<select value={r.type} onChange={e=>staff(i,{type:e.target.value as Personnel["type"]})}><option>Egen</option><option>UE</option><option>Ej angivet</option></select></label>
    <label>Yrkesgrupp<input value={r.trade} maxLength={150} onChange={e=>staff(i,{trade:e.target.value})}/></label><label>Företag / namn<input value={r.company} maxLength={200} onChange={e=>staff(i,{company:e.target.value})}/></label>
    <label>Antal<input type="number" min={0} max={10000} step={1} value={r.count} onChange={e=>staff(i,{count:e.target.value})}/></label><label>Timmar totalt<input type="number" min={0} max={100000} step="0.25" value={r.hours} onChange={e=>staff(i,{hours:e.target.value})}/></label>
    {!locked&&<button type="button" aria-label={`Ta bort personalrad ${i+1}`} onClick={()=>update({personnel:content.personnel.filter((_,n)=>n!==i)})}>×</button>}
   </div>)}{!locked&&<button type="button" disabled={content.personnel.length>=50} onClick={()=>update({personnel:[...content.personnel,{type:"Egen",trade:"",company:"",count:"",hours:""}]})}>+ Lägg till personalrad</button>}
   <div className="personnel-totals">{["Egen","UE","Ej angivet","Totalt"].map(type=>{const total=sum(type==="Totalt"?undefined:type);return <div key={type}><small>{type}</small><strong>{total.count} personer · {total.hours.toLocaleString("sv-SE")} timmar</strong></div>})}</div>
   </section>
   {!!content.work&&<section className="panel content-panel"><label>Tidigare utförda arbeten<textarea value={content.work} maxLength={10000} onChange={e=>update({work:e.target.value})}/></label><small className="muted">Bevarat från rapporten innan uppdelningen i pågående och färdigställda arbeten.</small></section>}
   <div className="diary-texts">{groups.map(group=><section className="panel content-panel diary-group" key={group.title}><h3>{group.title}</h3><div className="diary-group-fields">{group.fields.map(([key,label,hint])=><label key={key}>{label}<textarea rows={3} maxLength={10000} value={content[key] || ""} onChange={e=>update({[key]:e.target.value})}/>{hint&&<small className="muted">{hint}</small>}</label>)}</div></section>)}</div>
   <section className="panel content-panel"><h3>Fotografier, protokoll och bilagor</h3>{!locked&&<FilePicker files={files} disabled={saving} onChange={selected=>{setFiles(selected);props.onChanged(true)}}/>}</section>
  </fieldset>
  {!!content.files.length&&<div className="actions">{content.files.map(f=><button key={f.id} type="button" onClick={()=>void cloud.download(f).catch(e=>setMessage(String(e)))}>{f.name} ↓</button>)}</div>}
  {props.report?.submittedAt&&<section className="panel content-panel"><h3>Kvittens</h3><p className="muted">Kvittens visar vem som bekräftat rapporten och när. Det ändrar inte rapportens innehåll.</p>{(["siteManager","verifier"] as const).map(ack=>{const entry=props.report?.acknowledgements?.[ack],member=ack==="siteManager"?header.siteManagerId:header.verifierId;return <div className="diary-ack" key={ack}><div><strong>{ack==="siteManager"?"Ansvarig platschef":"Beställare/kontrollant"}</strong><p>{entry?`${entry.name} · Kvitterad ${displayDate(entry.at)}`:member?"Inväntar kvittens":"Ingen mottagare angiven"}</p></div>{!entry&&member===props.me.id&&<button type="button" disabled={saving} onClick={async()=>{setSaving(true);try{await props.onAck(reportId,ack)}finally{setSaving(false)}}}>Kvittera rapport</button>}</div>})}</section>}
  {message&&<p role="status" className="notice">{message}</p>}
  {!locked&&<div className="form-actions diary-save"><span className="muted">Beskriv pågående eller färdigställda arbeten innan du skickar rapporten. Inskickad rapport låses.</span><button type="button" disabled={saving} onClick={()=>void save(false)}>Spara utkast</button><button className="primary" type="submit" disabled={saving}>{saving?"Sparar…":"Skicka dagrapport"}</button></div>}
 </form>;
}
