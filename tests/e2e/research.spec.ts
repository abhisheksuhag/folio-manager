import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../server/app';
import type { Store } from '../../server/db';
import type { Workspace } from '../../shared/types';

// Every test uses a new browser context and an in-memory app on an ephemeral port.
// No existing browser profile, environment credentials, or data/ database is used.
let server:Server,store:Store,base:string,demoToken:string,liveToken:string;
let serverNetworkAttempts=0; const originalFetch=globalThis.fetch;
test.beforeAll(async()=>{
  globalThis.fetch=async()=>{serverNetworkAttempts++;throw new Error('Outbound network disabled in browser fixture');};
  const app=createApp({environment:'test',databasePath:':memory:',usdInr:87});
  store=app.locals.store as Store;
  const demo=store.createUser({name:'Research Fixture',email:'demo@synthetic.invalid',demo:true});
  store.seedDemoWatchlist(demo.id); demoToken=store.createSession(demo.id).token;
  const live=store.createUser({name:'Empty Fixture',email:'empty@synthetic.invalid'});liveToken=store.createSession(live.id).token;
  server=app.listen(0,'127.0.0.1'); await once(server,'listening');base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async()=>{if(server)await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));store?.db.close();globalThis.fetch=originalFetch;expect(serverNetworkAttempts).toBe(0);});

async function isolated(context:BrowserContext,page:Page,token=demoToken){
  const unexpected:string[]=[];
  await context.addCookies([{name:'folio_session',value:token,url:base,httpOnly:true,sameSite:'Lax'}]);
  await context.route('**/*',async route=>{
    const r=route.request();
    if(!r.url().startsWith(base+'/')||r.method()!=='GET'){unexpected.push(`${r.method()} ${new URL(r.url()).pathname}`);return route.abort();}
    if(r.url().includes('/api/logos/'))return route.fulfill({status:404,body:''});
    return route.continue();
  });
  page.on('pageerror',error=>unexpected.push(error.message));
  return ()=>expect(unexpected).toEqual([]);
}

test('fear and greed gauges show provenance, adapt to mobile, and handle feed failures',async({context,page})=>{
  const verify=await isolated(context,page);
  await page.goto(base+'/app');
  const panel=page.getByRole('region',{name:'Fear & greed'});
  await expect(panel.getByRole('meter')).toHaveCount(4);
  await expect(panel).toContainText('Illustrative demo');
  await expect(panel.getByRole('link',{name:'Alternative.me'})).toHaveAttribute('href','https://alternative.me/crypto/fear-and-greed-index/');
  await panel.getByText('How to read this').click();
  await expect(panel).toContainText('not a worldwide benchmark');
  await panel.screenshot({path:'test-results/research/sentiment-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await panel.screenshot({path:'test-results/research/sentiment-mobile.png'});
  await page.setViewportSize({width:320,height:740});
  // Check this component at 320px; the existing allocation table has a wider minimum.
  expect(await panel.evaluate(el=>[el,...el.querySelectorAll('*')].every(e=>e.getBoundingClientRect().right<=innerWidth&&e.getBoundingClientRect().left>=0))).toBe(true);
  await panel.screenshot({path:'test-results/research/sentiment-small-mobile.png'});
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await panel.getByText('How to read this').click();
  await panel.screenshot({path:'test-results/research/sentiment-dark.png'});
  await page.route('**/api/sentiment',route=>route.fulfill({status:503,json:{error:'Feed unavailable'}}));
  await page.reload();
  await expect(panel.getByText('Unavailable',{exact:true})).toHaveCount(4);
  await expect(panel.getByRole('meter')).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'Try again'})).toBeVisible();
  await page.unroute('**/api/sentiment');
  await panel.getByRole('button',{name:'Try again'}).click();
  await expect(panel.getByRole('meter')).toHaveCount(4);
  verify();
});

test('empty portfolios still see sentiment and missing feeds have no made-up gauges',async({context,page})=>{
  const verify=await isolated(context,page,liveToken);
  await page.goto(base+'/app');
  const panel=page.getByRole('region',{name:'Fear & greed'});
  await expect(panel.getByText('Unavailable',{exact:true})).toHaveCount(4);
  await expect(panel).toContainText('Needs recent readings from all three markets');
  await expect(panel.getByRole('meter')).toHaveCount(0);
  await expect(panel).not.toContainText('Illustrative demo');
  await page.route('**/api/sentiment',route=>route.fulfill({json:[
    {id:'US',score:22,label:'Extreme fear',asOf:'2026-09-25T12:00:00Z',source:'CNN',stale:true,notice:'Saved reading · feed unavailable'},
    {id:'IN',score:38,label:'Fear',asOf:'2026-09-28T12:00:00Z',source:'Tickertape',stale:false},
  ]}));
  await panel.getByRole('button',{name:'Refresh sentiment'}).click();
  await expect(panel.getByRole('meter')).toHaveCount(2);
  await expect(panel.getByText('Saved',{exact:true})).toBeVisible();
  await expect(panel.getByText('Unavailable',{exact:true})).toHaveCount(2);
  verify();
});

test('landing illustrations, fund preview and FAQ work on desktop and mobile',async({context,page})=>{
  const verify=await isolated(context,page);
  await page.goto(base+'/');
  await expect(page.getByRole('heading',{name:'A little less setup. A lot more perspective.'})).toBeVisible();
  const breakdown=page.getByRole('group',{name:'Example fund breakdown'});
  await breakdown.getByRole('button',{name:'Market mix'}).click();
  await expect(breakdown.getByRole('button',{name:'Market mix'})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.fund-mix-rows')).toContainText('India');
  await expect(page.locator('.fund-mix-rows')).not.toContainText('Technology');
  const question=page.locator('summary').filter({hasText:'Can I look around before connecting anything?'});
  await question.click();
  await expect(page.getByText('Yes. The demo opens an illustrative portfolio',{exact:false})).toBeVisible();
  await page.screenshot({path:'test-results/research/landing-desktop.png',fullPage:true});
  await page.locator('.landing-fund').screenshot({path:'test-results/research/landing-fund-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await breakdown.getByRole('button',{name:'Sector mix'}).click();
  await expect(page.locator('.fund-mix-rows')).toContainText('Technology');
  expect(await page.evaluate(()=>({width:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('.landing *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({class:e.getAttribute('class'),right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).slice(0,20)}))).toEqual(expect.objectContaining({width:390}));
  await page.screenshot({path:'test-results/research/landing-mobile.png',fullPage:true});
  await page.locator('.landing-fund').screenshot({path:'test-results/research/landing-fund-mobile.png'});
  await page.getByRole('link',{name:'How it works',exact:true}).click();
  await expect(page).toHaveURL(base+'/#how-it-works');
  await expect(page.locator('#how-it-works')).toBeInViewport();
  await page.getByRole('link',{name:'Find your starting point',exact:false}).click();
  await expect(page).toHaveURL(base+'/register');
  verify();
});

test('market sparklines stay compact and allocation tooltip paints above center text',async({context,page})=>{
  const verify=await isolated(context,page);
  await page.goto(base+'/app');
  const ribbon=page.getByRole('navigation',{name:'Market trends'});
  await expect(ribbon.getByRole('img')).toHaveCount(3);
  await expect(ribbon).toContainText('SPY ETF proxy');
  await expect(ribbon).toContainText('QQQ ETF proxy');
  await expect(ribbon.locator('.market-sparkline.negative')).toHaveCount(1);
  await page.screenshot({path:'test-results/research/dashboard-trends-desktop.png',fullPage:true});
  const donut=page.locator('.donut-wrap');
  await donut.scrollIntoViewIfNeeded();
  const box=(await donut.boundingBox())!;
  await page.mouse.move(box.x+box.width*.72,box.y+box.height*.20);
  const tooltip=donut.locator('.recharts-tooltip-wrapper');
  await expect(tooltip).toBeVisible();
  // Probe the actual paint order at the center. Pointer-events is disabled on
  // these decorative layers normally; enable only for this read-only hit test.
  const order=await donut.evaluate(el=>{
    const tip=el.querySelector<HTMLElement>('.recharts-tooltip-wrapper')!;
    const center=el.querySelector<HTMLElement>('.donut-center')!;
    const saved=[tip.style.cssText,center.style.cssText];
    tip.style.transform='none';tip.style.inset='0';tip.style.pointerEvents='auto';
    center.style.pointerEvents='auto';
    const bounds=center.getBoundingClientRect();
    const front=document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
    const onTop=tip===front||tip.contains(front);
    tip.style.cssText=saved[0];center.style.cssText=saved[1];return onTop;
  });
  expect(order).toBe(true);
  await donut.screenshot({path:'test-results/research/allocation-tooltip.png'});
  await page.setViewportSize({width:390,height:844});
  await page.mouse.move(0,0);
  await expect(ribbon.getByRole('img')).toHaveCount(3);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({path:'test-results/research/dashboard-trends-mobile.png',fullPage:true});
  await page.route('**/api/market-trends',route=>route.fulfill({json:[]}));
  await page.reload();
  await expect(ribbon.getByText('History unavailable',{exact:true})).toHaveCount(3);
  await expect(ribbon.getByRole('img')).toHaveCount(0);
  await ribbon.getByRole('link').first().click();
  await expect(page.getByRole('heading',{name:'S&P 500',exact:true})).toBeVisible();
  verify();
});

test('unified navigation and screener filters work across India and US',async({context,page})=>{
  const verify=await isolated(context,page);
  await page.goto(base+'/app/explore');
  await expect(page.getByRole('heading',{name:'Find your next idea.'})).toBeVisible();
  const nav=page.getByRole('navigation',{name:'Main navigation'});
  await expect(nav.getByRole('link',{name:'Portfolio',exact:true})).toBeVisible();
  await expect(nav.getByRole('link',{name:/Transactions|Markets|Holdings|Performance/})).toHaveCount(0);
  await page.getByRole('button',{name:'India',exact:true}).click();
  await page.getByLabel('Asset type',{exact:true}).selectOption('stocks');
  await page.getByLabel('Search companies and funds').fill('Reliance');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Reliance');
  await page.getByRole('button',{name:'Filters',exact:true}).click();
  await page.getByLabel('Maximum P/E',{exact:true}).fill('1');
  await expect(page.getByRole('heading',{name:'No matches in this view.'})).toBeVisible();
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await page.getByRole('button',{name:'United States',exact:true}).click();
  await page.getByLabel('Research universe').selectOption('SP500');
  await expect(page.locator('tbody')).toContainText('Apple');
  await expect(page.locator('tbody')).not.toContainText('Reliance');
  await page.screenshot({path:'test-results/research/explore-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('button',{name:'Open navigation',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await expect(nav.getByRole('link',{name:'Portfolio',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close navigation',exact:true}).last().click();
  await page.screenshot({path:'test-results/research/explore-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  verify();
});

test('mutual funds and ETFs show honest composition and stock research stays distinct',async({context,page})=>{
  const verify=await isolated(context,page);
  await page.goto(base+'/app/stock/in%3Amf%3Appfas');
  await expect(page.getByRole('heading',{name:'What your fund owns'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Annual financials'})).toHaveCount(0);
  await expect(page.getByRole('columnheader',{name:'Your estimated exposure'})).toBeVisible();
  await expect(page.locator('.composition-summary')).toContainText('31 Aug 2026');
  await expect(page.locator('.fund-composition .research-notice')).toContainText('not scaled');
  await page.screenshot({path:'test-results/research/fund-desktop.png',fullPage:true});
  await page.goto(base+'/app/stock/us%3Anasdaq%3Aqqq');
  await expect(page.getByRole('heading',{name:'What your fund owns'})).toBeVisible();
  await expect(page.locator('.fund-metrics')).toContainText('Nasdaq-100');
  await page.goto(base+'/app/stock/us%3Anasdaq%3Aaapl');
  await expect(page.getByRole('heading',{name:'Annual financials'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'What your fund owns'})).toHaveCount(0);
  await page.getByLabel('Financial metric').selectOption('netIncome');
  await expect(page.getByRole('img',{name:'Net income by fiscal year in USD'})).toBeVisible();
  await page.getByText('View financial statements',{exact:true}).click();
  await expect(page.getByRole('cell',{name:'Net income',exact:true})).toBeVisible();
  verify();
});

test('holdings come first and missing history remains compact on desktop and mobile',async({context,page})=>{
  const verify=await isolated(context,page);
  await page.route('**/api/workspace',async route=>{const response=await route.fetch();const w=await response.json() as Workspace;await route.fulfill({json:{...w,history:[]}});});
  await page.goto(base+'/app/portfolio');
  await expect(page.getByRole('heading',{name:/Your holdings/})).toBeVisible();
  const chips=page.getByRole('group',{name:'Quick asset filters'});
  await chips.getByRole('button',{name:'Mutual funds',exact:true}).click();
  await expect(page.getByLabel('Filter by asset class')).toHaveCount(0);
  await expect(page.locator('.portfolio-table tbody tr')).toHaveCount(2);
  await page.getByLabel('Filter by platform').selectOption('INDmoney');
  await expect(page.getByText('No holdings match these filters.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await expect(chips.getByRole('button',{name:'All holdings',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.portfolio-overview')).not.toContainText('Not enough history');
  await expect(page.locator('.compact-history')).toHaveCount(1);
  expect((await page.locator('.compact-history').boundingBox())!.height).toBeLessThan(210);
  const chipBox=await chips.boundingBox();const searchBox=await page.getByLabel('Search holdings').boundingBox();
  expect(Math.abs(chipBox!.y-searchBox!.y)).toBeLessThan(10);
  await page.screenshot({path:'test-results/research/portfolio-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/research/portfolio-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,overflow:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(e).position!=='fixed').slice(0,10).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right}))}))).toEqual(expect.objectContaining({width:390}));
  await chips.getByRole('button',{name:'Mutual funds',exact:true}).click();
  await expect(chips.getByRole('button',{name:'Mutual funds',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.portfolio-table tbody tr')).toHaveCount(2);
  await page.locator('.portfolio-table tbody tr').first().getByRole('link',{name:'Composition',exact:true}).click();
  await expect(page.getByRole('heading',{name:'What your fund owns'})).toBeVisible();
  await page.screenshot({path:'test-results/research/fund-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  verify();
});

test('known indexes degrade to useful metadata and legacy routes redirect',async({context,page})=>{
  const verify=await isolated(context,page,liveToken);
  await page.goto(base+'/app/index/SP500');
  await expect(page.getByRole('heading',{name:'S&P 500',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'This list isn’t available yet.'})).toBeVisible();
  await expect(page.getByText('Index not found',{exact:true})).toHaveCount(0);
  await page.goto(base+'/app/markets');await expect(page).toHaveURL(base+'/app/explore');
  await page.goto(base+'/app/transactions');await expect(page).toHaveURL(base+'/app/portfolio');
  await page.goto(base+'/app/holdings');await expect(page).toHaveURL(base+'/app/portfolio');
  verify();
});

test('missing FX and cost basis leave totals unavailable while native holdings remain usable',async({context,page})=>{
  const verify=await isolated(context,page);
  await page.route('**/api/workspace',async route=>{
    const response=await route.fetch();const w=await response.json() as Workspace;
    await route.fulfill({json:{...w,history:[],fx:{USDINR:0,asOf:'',source:'Unavailable'},holdings:w.holdings.map((h,i)=>i===0?{...h,averagePrice:0}:h)}});
  });
  await page.goto(base+'/app/portfolio');
  await expect(page.locator('.portfolio-overview strong')).toHaveText(['—','—','—']);
  await expect(page.locator('.portfolio-table tbody')).toContainText('$226.00');
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Explore',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Find your next idea.'})).toBeVisible();
  verify();
});
