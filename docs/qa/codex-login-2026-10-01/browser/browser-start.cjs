const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto('http://127.0.0.1:3000'); await page.getByRole('button',{name:'시나리오',exact:true}).waitFor();
 await page.screenshot({path:'/workspace/ensemble-qa/01-start.png',fullPage:true});
 await page.getByRole('button',{name:'시나리오',exact:true}).click();
 console.log((await page.locator('body').innerText()).slice(-5000));
 await page.screenshot({path:'/workspace/ensemble-qa/02-scenario.png',fullPage:true});
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
