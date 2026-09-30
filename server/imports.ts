import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import type { AssetClass, Broker, HistoryPoint, Security, Transaction, TransactionType } from '../shared/types.ts';
import type { Store } from './db.ts';
import { randomToken } from './security.ts';

const currency = z.enum(['INR','USD']);
const country = z.enum(['IN','US']);
const assetClass = z.enum(['US equity','Indian equity','Mutual fund','ETF','Cash']);
const broker = z.enum(['INDmoney','Upstox','Manual']);
const transactionType = z.enum(['Buy','Sell','Dividend','Deposit','Withdrawal','MF purchase','MF redemption','Split','Fee','Tax']);
const positive = z.coerce.number().finite().nonnegative();
const strictlyPositive = z.coerce.number().finite().positive();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}(?:T.*)?$/, 'must be an ISO date').refine((value)=>!Number.isNaN(Date.parse(value.length===10?`${value}T00:00:00Z`:value)),'must be a real calendar date');

const holdingsRow = z.object({
  ticker:z.string().trim().regex(/^[A-Za-z0-9.\-]{1,40}$/,'contains unsafe characters'), name:z.string().trim().min(1), exchange:z.string().trim().min(1), currency,
  country, assetClass, sector:z.string().trim().min(1), quantity:z.coerce.number().finite().positive(),
  averagePrice:positive, price:strictlyPositive, previousClose:strictlyPositive, asOf:isoDate,
  accountId:z.string().trim().optional().default('default'), isin:z.string().trim().optional(),
}).strict().superRefine((row,context)=>{
  if((row.country==='US'&&row.currency!=='USD')||(row.country==='IN'&&row.currency!=='INR'))context.addIssue({code:'custom',path:['currency'],message:'does not match country'});
  if((row.country==='US'&&row.assetClass==='Indian equity')||(row.country==='IN'&&row.assetClass==='US equity'))context.addIssue({code:'custom',path:['assetClass'],message:'does not match country'});
});

const transactionRow = z.object({
  id:z.string().trim().optional(), date:isoDate, securityId:z.string().trim().optional(), ticker:z.string().trim().min(1),
  name:z.string().trim().min(1), broker:broker.optional(), accountId:z.string().trim().optional().default('default'), type:transactionType,
  quantity:z.coerce.number().finite(), price:z.coerce.number().finite().nonnegative(), amount:z.coerce.number().finite(), currency,
  splitRatio:z.union([z.literal(''),z.coerce.number().positive()]).optional(),
}).strict();

const historyRow = z.object({ date:isoDate,value:positive,invested:positive,netFlow:z.coerce.number().finite(),benchmark:z.union([z.literal(''),positive]).optional() }).strict();
const constituentsRow = z.object({index:z.string().trim().min(1),ticker:z.string().trim().min(1),name:z.string().trim().min(1),exchange:z.string().trim().min(1),currency,country,sector:z.string().trim().min(1),assetClass:assetClass.optional()}).strict();

export type ImportKind = 'holdings'|'transactions'|'history'|'constituents';

export const templates:Record<ImportKind,string> = {
  holdings:'ticker,name,exchange,currency,country,assetClass,sector,quantity,averagePrice,price,previousClose,asOf,accountId,isin\nAAPL,Apple,NASDAQ,USD,US,US equity,Technology,2,180,225,223,2026-09-04,main,US0378331005\n',
  transactions:'id,date,securityId,ticker,name,broker,accountId,type,quantity,price,amount,currency,splitRatio\n,2026-09-01,us:nasdaq:aapl,AAPL,Apple,Manual,main,Buy,2,200,400,USD,\n',
  history:'date,value,invested,netFlow,benchmark\n2026-09-01,2500000,2050000,0,2380000\n',
  constituents:'index,ticker,name,exchange,currency,country,sector,assetClass\nNIFTY50,RELIANCE,Reliance Industries,NSE,INR,IN,Energy,Indian equity\n',
};

function readRows(csv:string):Array<Record<string,string>> {
  if (Buffer.byteLength(csv,'utf8') > 5_000_000) throw new Error('CSV exceeds the 5 MB limit');
  try {
    return parse(csv,{columns:true,skip_empty_lines:true,trim:true,bom:true,relax_column_count:false}) as Array<Record<string,string>>;
  } catch (error) {
    throw new Error(`CSV parse error: ${error instanceof Error ? error.message : 'invalid file'}`);
  }
}

function validated<T>(rows:Array<Record<string,string>>, schema:z.ZodType<T>):T[] {
  if (!rows.length) throw new Error('CSV contains no data rows');
  return rows.map((row,index)=>{
    const result=schema.safeParse(row);
    if (!result.success) {
      const issue=result.error.issues[0];
      throw new Error(`CSV row ${index+2}, ${issue.path.join('.')||'row'}: ${issue.message}`);
    }
    return result.data;
  });
}

function securityId(countryValue:'IN'|'US',exchange:string,ticker:string):string {
  return `${countryValue.toLowerCase()}:${exchange.toLowerCase()}:${ticker.toLowerCase()}`;
}

function importedSecurity(row:{ticker:string;name:string;exchange:string;currency:'INR'|'USD';country:'IN'|'US';sector:string;assetClass:AssetClass;price?:number;previousClose?:number;asOf?:string;isin?:string;index?:string}):Security {
  return {id:securityId(row.country,row.exchange,row.ticker),ticker:row.ticker.toUpperCase(),name:row.name,exchange:row.exchange.toUpperCase(),currency:row.currency,country:row.country,assetClass:row.assetClass,sector:row.sector,isin:row.isin||undefined,color:'#64748b',price:row.price??0,previousClose:row.previousClose??row.price??0,indices:row.index?[row.index.toUpperCase()]:[],asOf:row.asOf??new Date().toISOString().slice(0,10),source:'CSV import'};
}

function stableHash(value:unknown):string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export function importCsv(store:Store,userId:string,input:{csv:string;broker:Broker;kind:ImportKind}):number {
  const raw=readRows(input.csv);
  if (input.kind==='holdings') {
    const rows=validated(raw,holdingsRow);
    const seen=new Set<string>();
    const holdings=rows.map((row,index)=>{
      const security=importedSecurity(row);
      const key=`${row.accountId}:${security.id}`;
      if(seen.has(key)) throw new Error(`CSV row ${index+2}: duplicate holding for account and security`);
      seen.add(key);
      return {security,accountId:row.accountId,quantity:row.quantity,averagePrice:row.averagePrice};
    });
    return store.replaceBrokerHoldings(userId,input.broker,holdings);
  }
  if(input.kind==='transactions') {
    const rows=validated(raw,transactionRow);
    const transactions:Array<Transaction&{contentHash:string}>=rows.map((row)=>{
      if(row.broker&&row.broker!==input.broker) throw new Error(`CSV broker ${row.broker} does not match selected broker ${input.broker}`);
      if(row.securityId&&!store.userHasSecurity(userId,row.securityId.toLowerCase())) throw new Error(`Unknown securityId ${row.securityId} for this account`);
      const normalized={date:row.date.slice(0,10),securityId:row.securityId||undefined,ticker:row.ticker.toUpperCase(),name:row.name,broker:input.broker,accountId:row.accountId,type:row.type as TransactionType,quantity:row.quantity,price:row.price,amount:row.amount,currency:row.currency,splitRatio:row.splitRatio===''?undefined:row.splitRatio};
      const contentHash=row.id?stableHash({broker:input.broker,id:row.id}):stableHash(normalized);
      return {id:row.id||randomToken(14),...normalized,contentHash};
    });
    const imported=store.insertTransactions(userId,transactions); store.upsertCsvConnection(userId,input.broker); return imported;
  }
  if(input.kind==='history') {
    const rows=validated(raw,historyRow);
    const seen=new Set<string>();
    const history:HistoryPoint[]=rows.map((row,index)=>{
      const date=row.date.slice(0,10); if(seen.has(date)) throw new Error(`CSV row ${index+2}: duplicate history date`); seen.add(date);
      return {date,value:row.value,invested:row.invested,netFlow:row.netFlow,benchmark:row.benchmark===''?undefined:row.benchmark};
    });
    const imported=store.replaceHistory(userId,history); store.upsertCsvConnection(userId,input.broker); return imported;
  }
  const rows=validated(raw,constituentsRow);
  const imported=store.transaction(()=>{
    for(const row of rows) store.upsertSecurity(userId,importedSecurity({...row,index:row.index,assetClass:row.assetClass??(row.country==='US'?'US equity':'Indian equity')}));
    return rows.length;
  });
  store.upsertCsvConnection(userId,input.broker);
  return imported;
}
