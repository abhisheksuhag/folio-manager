import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIndmoneyHoldingRows } from '../server/providers/indmoney.ts';
import { Store } from '../server/db.ts';
import type { Security } from '../shared/types.ts';

const position={investment_code:'INDS001',investment:'Example Indian Stock',total_units:20,invested_amount:2000,market_value:2500,one_day_change:10};

test('INDmoney always excludes Upstox source rows, even without an active direct connection',()=>{
  for(const broker of ['Upstox',' UPSTOX ','Upstox Securities Pvt. Ltd.','Upstox Securities Private Limited']){
    assert.deepEqual(parseIndmoneyHoldingRows('IND_STOCK',{holdings:[{...position,broker}]}),[],broker);
  }
});

test('identical securities at other brokers and unlabelled holdings are preserved',()=>{
  const holdings=['Upstox','INDmoney','Another Broker',null,undefined].map(broker=>({...position,broker}));
  const kept=parseIndmoneyHoldingRows('IND_STOCK',{holdings});
  assert.deepEqual(kept.map(row=>row.broker),['INDmoney','Another Broker',null,undefined]);
  assert.equal(kept.reduce((total,row)=>total+row.total_units!,0),80);
  assert.equal(parseIndmoneyHoldingRows('MF',{holdings:[{...position,broker:'INDmoney'}]}).length,1);
});

test('additional connected-broker exclusions remain supported and malformed payloads fail safely',()=>{
  assert.equal(parseIndmoneyHoldingRows('IND_STOCK',{holdings:[{...position,broker:' Another Broker '}]},['another broker']).length,0);
  assert.throws(()=>parseIndmoneyHoldingRows('IND_STOCK',{}),/no holdings list/);
  assert.throws(()=>parseIndmoneyHoldingRows('IND_STOCK',{holdings:[{broker:'INDmoney'}]}));
});

test('replacing an INDmoney snapshot clears mirrored holdings without removing direct Upstox or genuine INDmoney positions',()=>{
  const store=new Store(':memory:');
  try{
    const user=store.createUser({name:'Synthetic',email:'synthetic@example.test'});
    const security:Security={id:'in:nse:example',ticker:'EXAMPLE',name:'Example',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Technology',color:'#444',price:125,previousClose:124,indices:[],asOf:'2026-09-07',source:'Synthetic fixture'};
    const row={security,accountId:'fixture',quantity:20,averagePrice:100};
    store.replaceBrokerHoldings(user.id,'Upstox',[row],'oauth');
    store.replaceBrokerHoldings(user.id,'INDmoney',[{...row,quantity:40}],'mcp');
    const kept=parseIndmoneyHoldingRows('IND_STOCK',{holdings:[{...position,broker:'Upstox'},{...position,broker:'INDmoney'}]});
    store.replaceBrokerHoldings(user.id,'INDmoney',kept.map(p=>({...row,quantity:p.total_units!})),'mcp');
    const holdings=store.holdings(user.id);
    assert.equal(holdings.length,2);
    assert.equal(holdings.reduce((sum,h)=>sum+h.quantity*h.security.price,0),5000);
    assert.equal(holdings.find(h=>h.broker==='Upstox')?.quantity,20);
    assert.equal(holdings.find(h=>h.broker==='INDmoney')?.quantity,20);
  }finally{store.db.close();}
});
