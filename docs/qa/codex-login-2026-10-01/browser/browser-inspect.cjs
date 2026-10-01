const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const p=await b.newPage({viewport:{width:1440,height:1000}});await p.goto('http://127.0.0.1:3000');await p.getByRole('button',{name:'PM 판단 기록'}).waitFor();console.log(await p.locator('body').innerText());await b.close();})();
