import { createClient } from '@supabase/supabase-js';
export const runtime='nodejs';
export async function POST(request:Request){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key||!secret)return Response.json({error:'Kontohanteringen är inte konfigurerad.'},{status:503});
 const token=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token)return Response.json({error:'Logga in först.'},{status:401});
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const client=createClient(url,key,{...options,global:{headers:{Authorization:`Bearer ${token}`}}});
 const {data:identity,error:authError}=await client.auth.getUser(token);
 if(authError||!identity.user)return Response.json({error:'Logga in igen.'},{status:401});
 let input;try{input=await request.json();}catch{return Response.json({error:'Ogiltiga uppgifter.'},{status:400});}
 const {workspace,revision,details}=input;
 if(!details||typeof workspace!=='string'||!Number.isSafeInteger(revision))return Response.json({error:'Välj en giltig arbetsyta.'},{status:400});
 const text=(name:string,max:number)=>typeof details[name]==='string'&&details[name].trim().length>0&&details[name].trim().length<=max;
 if(!text('name',150)||!/^\S+(?:\s+\S+)+$/.test(details.name.trim())||!text('job',150)||!text('phone',40)||!text('email',254)||!/^\S+@\S+\.\S+$/.test(details.email)||typeof details.password!=='string'||details.password.length<8||details.password.length>128)return Response.json({error:'Kontrollera namn, yrkesroll, telefon, e-post och lösenord (8–128 tecken).'},{status:400});
 const {data:context,error:contextError}=await client.rpc('brief_beta_account_context',{workspace_id:workspace});
 if(contextError)return Response.json({error:contextError.message},{status:403});
 const rank:Record<string,number>={admin:1,site_manager:2,supervisor:2,worker:3};
 if(!rank[details.role]||(context.role!=='admin'&&rank[details.role]<rank[context.role]))return Response.json({error:'Du får inte tilldela den rollen.'},{status:403});
 const server=createClient(url,secret,options);
 const {data:created,error:createError}=await server.auth.admin.createUser({email:details.email.trim().toLowerCase(),password:details.password,email_confirm:true,user_metadata:{full_name:details.name.trim(),job_title:details.job.trim(),company_name:context.employer,phone:details.phone.trim()},app_metadata:{brief_provisioned:true,brief_password_suggested:true}});
 if(createError||!created.user)return Response.json({error:'Kontot kunde inte skapas. Kontrollera om e-postadressen redan har ett konto.'},{status:400});
 const {error:profileError}=await server.rpc('brief_beta_register_account',{actor:identity.user.id,workspace_id:workspace,expected_revision:revision,new_user:created.user.id,details:{name:details.name.trim(),email:details.email.trim().toLowerCase(),job:details.job.trim(),phone:details.phone.trim(),role:details.role,organizationLevel:details.organizationLevel}});
 if(profileError){const {error:cleanupError}=await server.auth.admin.deleteUser(created.user.id);if(cleanupError)console.error('Provisioning rollback failed for account',created.user.id);return Response.json({error:profileError.message},{status:409});}
 return Response.json({ok:true});
}
