"use client";
import {useState} from 'react';
import {firmLogo} from '../../lib/beta-cloud';
export default function CompanyLogoUpload({workspace,logo,demo,onChanged}:{workspace:string;logo?:string;demo:boolean;onChanged:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function save(file?:File){setBusy(true);setMessage('');try{
  if(demo)throw Error('Logguppladdning görs i din inloggade arbetsyta.');
  let data:string|null=null;
  if(file){if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Välj PNG, JPG eller WebP på högst 5 MB.');
   const bitmap=await createImageBitmap(file);try{const ratio=Math.min(1,800/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);data=canvas.toDataURL('image/png');if(data.length>682690)throw Error('Bilden är för stor efter anpassning. Välj en enklare eller mindre logga.');}finally{bitmap.close();}}
  await firmLogo(workspace,data);await onChanged();setMessage(file?'Företagsloggan sparad.':'Företagsloggan borttagen.');
 }catch(e){setMessage(e instanceof Error?e.message:'Loggan kunde inte sparas.');}finally{setBusy(false);}}
 return <div className="company-logo-upload"><label>Ladda upp företagslogga<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void save(f);}}/></label><small>PNG, JPG eller WebP, högst 5 MB. Bildens proportioner behålls.</small>{logo&&<button disabled={busy} type="button" onClick={()=>void save()}>Ta bort logga</button>}{message&&<p role="status">{message}</p>}</div>;
}
