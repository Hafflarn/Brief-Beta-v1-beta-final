"use client";
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { changePassword } from '../../lib/beta-cloud';
import { validateForm } from '../../lib/form-validation';
export default function PasswordForm({demo,onMessage,onSaved}:{demo:boolean;onMessage:(message:string)=>void;onSaved:()=>void|Promise<void>}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const report=(text:string)=>{setMessage(text);onMessage(text);};
 return <form noValidate onSubmit={async e=>{e.preventDefault();if(busy||!validateForm(e.currentTarget,report))return;const form=e.currentTarget;const f=new FormData(form);if(f.get('password')!==f.get('confirmPassword')){report('Bekräfta lösenord: lösenorden måste vara lika.');form.querySelector<HTMLInputElement>('[name="confirmPassword"]')?.focus();return;}setBusy(true);try{if(!demo){if(!supabase)throw Error('Anslutningen saknas.');await changePassword(String(f.get('password')));}form.reset();report('Lösenordet är uppdaterat.');await onSaved();}catch(error){report(error instanceof Error?error.message:'Lösenordet kunde inte ändras.');}finally{setBusy(false);}}}>
 <label>Nytt lösenord<input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
 <label>Bekräfta lösenord<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
 {message&&<p className="notice" role="alert">{message}</p>}<button className="primary" disabled={busy}>{busy?'Sparar…':'Spara lösenord'}</button></form>;
}
