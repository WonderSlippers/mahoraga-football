// Explicit optional network verification; excluded from offline test commands.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const dir='.runtime-v2/source-probes';
fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5274/workbench');
 await page.getByRole('heading',{name:'真实来源观察',exact:true}).waitFor();
 const response=page.waitForResponse(r=>r.url().endsWith('/source-captures'),{timeout:60000});
 await page.getByRole('button',{name:'采集德甲公开赛程'}).click();
 const result=await response;
 const body=await result.json();
 const name=new Date().toISOString().replaceAll(':','-');
 fs.writeFileSync(`${dir}/capture-${name}.json`,JSON.stringify({httpStatus:result.status(),...body,errors},null,2));
 await page.getByRole('button',{name:'采集德甲公开赛程'}).waitFor();
 await page.screenshot({path:`${dir}/research-desktop.png`,fullPage:false});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:`${dir}/research-mobile.png`,fullPage:false});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 console.log(JSON.stringify({httpStatus:result.status(),...body,errors,overflow}));
 if (!result.ok() || body.data?.state !== 'DEGRADED' || body.data?.normalizedCount < 1 || errors.length || overflow) process.exitCode=1;
} finally {await browser.close();}
