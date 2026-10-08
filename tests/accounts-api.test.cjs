const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
function handler(file,createClient,fetch,secret="private"){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:()=>({createClient}),process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://db.test',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:secret}},Response,fetch,console,Deno:{env:{get:name=>({SUPABASE_URL:"https://db.test",SUPABASE_ANON_KEY:"public",SUPABASE_SERVICE_ROLE_KEY:"private"})[name]},serve:()=>{}}});return exports.POST;}
const request=body=>new Request('https://brief.test/api/accounts',{method:'POST',headers:{authorization:'Bearer caller','Content-Type':'application/json'},body:JSON.stringify(body)});
const input={workspace:'w',revision:1,details:{name:'Anna Andersson',job:'Snickare',phone:'0701234567',email:'anna@test.se',role:'worker',password:'Tilldelat123'}};
test('Account route denies invalid session and workers before privileged provisioning',async()=>{
 let creates=0;const server={auth:{admin:{createUser:async()=>{creates++;return {data:{user:{id:'new'}}};}}}};
 const invalid=handler('app/api/accounts/route.ts',(_,key)=>key==='private'?server:{auth:{getUser:async()=>({data:{user:null},error:{}})}});
 assert.equal((await invalid(request(input))).status,401);assert.equal(creates,0);
 const worker=handler('app/api/accounts/route.ts',(_,key)=>key==='private'?server:{auth:{getUser:async()=>({data:{user:{id:'worker'}}})},rpc:async()=>({error:{message:'Du får inte skapa konton.'}})});
 assert.equal((await worker(request(input))).status,403);assert.equal(creates,0);
});
test('Provisioned accounts are tied to the validated actor; failed membership creation rolls back Auth',async()=>{
 const calls=[];let fail=false;const client={auth:{getUser:async()=>({data:{user:{id:'actor'}}})},rpc:async()=>({data:{employer:'Rätt firma',role:'admin'}})};
 const server={auth:{admin:{createUser:async value=>{calls.push(value);return {data:{user:{id:'new'}}};},deleteUser:async id=>{calls.push({delete:id});return {};}}},rpc:async(name,value)=>{calls.push({name,value});return fail?{error:{message:'Revisionen har ändrats.'}}:{};}};
 const post=handler('app/api/accounts/route.ts',(_,key)=>key==='private'?server:client);
 assert.equal((await post(request(input))).status,200);assert.equal(calls[0].app_metadata.brief_provisioned,true);assert.equal(calls[0].app_metadata.brief_password_suggested,true);assert.equal(calls[0].user_metadata.company_name,'Rätt firma');assert.equal(calls[1].value.actor,'actor');assert(!('password' in calls[1].value.details));
 fail=true;assert.equal((await post(request(input))).status,409);assert.equal(calls.at(-1).delete,'new');
});
test('Password route changes only the authenticated caller through their own token',async()=>{
 let update;const client={auth:{getUser:async()=>({data:{user:{id:'actor'}}})},rpc:async()=>({})};
 const post=handler('app/api/password/route.ts',()=>client,async(url,options)=>{update={url,options};return Response.json({id:'actor'});});
 assert.equal((await post(request({password:'MittNya123'}))).status,200);assert.equal(update.url,'https://db.test/auth/v1/user');assert.equal(update.options.headers.Authorization,'Bearer caller');assert.deepEqual(JSON.parse(update.options.body),{password:'MittNya123'});
});

test('Missing Vercel secret forwards only validated manager requests to Edge',async()=>{
 let forwarded;const client={auth:{getUser:async()=>({data:{user:{id:'actor'}}})},rpc:async()=>({data:{employer:'Firma',role:'admin'}})};
 const post=handler('app/api/accounts/route.ts',()=>client,async(url,options)=>{forwarded={url,options};return Response.json({ok:true});},undefined);
 // Explicitly remove secret: the helper default is intentionally used for other tests.
 const fallback=handler('app/api/accounts/route.ts',()=>client,async(url,options)=>{forwarded={url,options};return Response.json({ok:true});},'');
 assert.equal((await fallback(request(input))).status,200);assert.equal(forwarded.url,'https://db.test/functions/v1/brief-accounts');assert.equal(forwarded.options.headers.Authorization,'Bearer caller');
});
test('Edge provisioning verifies identity and blocks workers independently',async()=>{
 let creates=0;const post=handler('supabase/functions/brief-accounts/index.ts',(_,key)=>key==='private'?{auth:{admin:{createUser:async()=>{creates++;return {};}}}}:{auth:{getUser:async()=>({data:{user:{id:'worker'}}})},rpc:async()=>({error:{message:'Du får inte skapa konton.'}})});
 assert.equal((await post(request(input))).status,403);assert.equal(creates,0);
});
