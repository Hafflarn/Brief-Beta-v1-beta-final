import { createClient } from '@supabase/supabase-js';
export const runtime='nodejs';
export async function POST(request:Request){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)return Response.json({error:'Anslutningen saknas.'},{status:503});
 const token=request.headers.get('authorization')?.replace(/^Bearer /,'');if(!token)return Response.json({error:'Logga in först.'},{status:401});
 const client=createClient(url,key,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:identity,error:authError}=await client.auth.getUser(token);if(authError||!identity.user)return Response.json({error:'Logga in igen.'},{status:401});
 let input;try{input=await request.json();}catch{return Response.json({error:'Ogiltigt lösenord.'},{status:400});}
 if(typeof input.password!=='string'||input.password.length<8||input.password.length>128)return Response.json({error:'Lösenordet ska ha 8–128 tecken.'},{status:400});
 // Update the caller through their own session; Supabase enforces secure password-change rules.
 const response=await fetch(`${url}/auth/v1/user`,{method:'PUT',headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({password:input.password})});
 if(!response.ok){const error=await response.json();return Response.json({error:error.msg||error.message||'Lösenordet kunde inte ändras.'},{status:400});}
 const {error}=await client.rpc('brief_beta_password_suggestion_dismiss');if(error)return Response.json({error:'Lösenordet har ändrats, men inloggningspåminnelsen kunde inte avslutas.'},{status:500});
 return Response.json({ok:true});
}
