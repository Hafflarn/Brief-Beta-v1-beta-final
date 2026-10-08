const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const server=require('node:child_process').spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3005'],{stdio:['ignore','pipe','pipe']});
(async () => {
 await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(d.toString().includes('Ready'))resolve()});server.once('error',reject);server.once('exit',code=>reject(Error('Server exited '+code)))});
 const browser = await chromium.launch({executablePath:process.env.BRIEF_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});
 try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.BRIEF_TEST_URL || 'http://127.0.0.1:3005');
  await page.getByText('Logga in till din arbetsyta.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Byt till mörkt tema',exact:true}).click();
  fs.mkdirSync('docs/screenshots',{recursive:true});
  await page.screenshot({path:'docs/screenshots/layout-login.png',fullPage:true});
  await page.getByRole('button',{name:'Öppna demonstration'}).click();
  await page.getByRole('heading',{name:'Översikt',exact:true}).waitFor();
  await page.getByRole('button',{name:'Företagslista',exact:true}).click();
  assert.deepEqual(await page.locator('.compact-orders th').allTextContents().then(a=>a.map(x=>x.replace(/\s+/g,' ').trim())),['Status','ProjektnummerOrdernr','Arbete','Adress','Utförare']);
  for(const [role,allowed] of [['samuel',true],['anna',true],['erik',false]]) {
   await page.getByLabel('Demoprofil').selectOption(role);
   await page.getByRole('button',{name:'Öppna kontomeny'}).click();
   assert.equal(await page.getByRole('region',{name:'Mitt företag'}).count(),allowed?1:0);
   assert.equal(await page.locator('.account-dropdown').getByRole('button',{name:/Min profil/}).count(),1);
   assert.equal(await page.locator('.account-dropdown').getByRole('button',{name:/Mina kollegor/}).count(),1);
   if(allowed) assert.equal(await page.locator('.account-colleagues button').count(),3);
   await page.getByRole('button',{name:'Stäng kontomeny'}).click({position:{x:2,y:2}});
  }
  await page.getByLabel('Demoprofil').selectOption('samuel');
  await page.getByRole('button',{name:'Företagslista',exact:true}).click();
  await page.getByRole('button',{name:'Öppna kontomeny'}).click();
  await page.screenshot({path:'docs/screenshots/layout-desktop.png',fullPage:true});
  await page.locator('.account-colleagues button').filter({hasText:'Erik Svensson'}).click();
  await page.getByRole('heading',{name:'Erik Svensson',exact:true}).waitFor();
  await page.getByRole('button',{name:'Brief – till startsidan'}).click();
  for(const width of [320,360,390,700]) {
   await page.setViewportSize({width,height:844});
   await page.getByRole('button',{name:'Företagslista',exact:true}).click();
   assert.deepEqual(await page.locator('.compact-orders th:visible').evaluateAll(els=>els.map(el=>el.innerText)),['Status','Ordernr','Arbete']);
   assert(await page.locator('.mobile-assignee:visible').count()>0);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   if(overflow){console.log(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right})).slice(0,15)));await page.screenshot({path:'docs/screenshots/overflow.png',fullPage:true});} assert.equal(overflow,false,'No horizontal page overflow at '+width);
   if(width===390) await page.screenshot({path:'docs/screenshots/layout-mobile.png',fullPage:true});
   await page.getByRole('button',{name:'Öppna kontomeny'}).click();
   const box=await page.locator('.account-dropdown').boundingBox();assert(box.x>=0 && box.x+box.width<=width);
   await page.getByRole('button',{name:'Stäng kontomeny'}).click({position:{x:2,y:2}});
  }
  await page.getByRole('button',{name:'Byt till ljust tema',exact:true}).click();
  await page.screenshot({path:'docs/screenshots/layout-mobile-light.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: roles, colleague navigation, desktop columns, mobile columns and performers, 320–700px overflow, light/dark, no browser errors');
 } finally {await browser.close();server.kill();}
})().catch(e=>{console.error(e);server.kill();process.exitCode=1});
